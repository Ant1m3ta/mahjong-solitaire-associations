import { useEffect, useMemo, useState } from 'react';
import { applyReorderRow, buildReorderPlan, type ReorderRow } from './batchReorder';
import { saveLevelJSON, type LevelFileEntry } from './save';

interface Props {
  entries: LevelFileEntry[];
  needsFolder: boolean;
  boundFolder: string | null;
  onPickFolder: () => void;
  onWrote: () => void;
  onClose: () => void;
}

export function ReorderModal({ entries, needsFolder, boundFolder, onPickFolder, onWrote, onClose }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const plan = useMemo(() => buildReorderPlan(entries), [entries]);

  const isTrap = (r: ReorderRow) => r.status === 'trap-fixed' || r.status === 'trap-unfixable';
  const needsAttention = (r: ReorderRow) => isTrap(r) || r.status === 'error';
  const fixableCount = plan.filter((r) => r.status === 'trap-fixed').length;
  const issueCount = plan.filter(needsAttention).length;
  const visible = onlyIssues ? plan.filter(needsAttention) : plan;

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function saveLevel(row: ReorderRow) {
    setBusy(row.name);
    setError(null);
    setSavedNote(null);
    try {
      const level = applyReorderRow(row);
      await saveLevelJSON(level, row.name);
      setSavedNote(`Saved ${row.name}.`);
      onWrote();
    } catch (e) {
      setError(`${row.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveAllFixable() {
    setBusy('*');
    setError(null);
    setSavedNote(null);
    let count = 0;
    try {
      for (const row of plan) {
        if (row.status !== 'trap-fixed') continue;
        const level = applyReorderRow(row);
        await saveLevelJSON(level, row.name);
        count++;
      }
      setSavedNote(`Reordered & saved ${count} level${count === 1 ? '' : 's'}.`);
      onWrote();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const needsPick = needsFolder && !boundFolder;
  const unsupported = !needsFolder;

  return (
    <div className="picker-overlay" onClick={() => !busy && onClose()}>
      <div className="picker-modal batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>Fix draw order</span>
          <span className="picker-constraint">straightforward-play traps</span>
          <button className="editor-btn small" onClick={onClose} disabled={!!busy}>×</button>
        </div>

        {unsupported ? (
          <div className="batch-body">
            <div className="warn-row warn-error">
              Reordering writes files in place via the File System Access API. Open the editor in
              Chrome / Edge / Arc / Brave to use it.
            </div>
          </div>
        ) : needsPick ? (
          <div className="batch-body">
            <div className="editor-empty">Pick the levels folder to scan and write back into.</div>
            <button className="editor-btn primary" onClick={onPickFolder}>Pick folder…</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="batch-body">
            <div className="editor-empty">No level files found in {boundFolder}.</div>
          </div>
        ) : (
          <>
            <div className="batch-controls">
              <div className="batch-select-actions">
                <span className="batch-folder">→ {boundFolder}</span>
                <button
                  className="editor-btn small primary"
                  onClick={saveAllFixable}
                  disabled={!!busy || fixableCount === 0}
                  title="Reorder & save every level the straightforward player softlocks on but a reorder fixes"
                >
                  {busy === '*' ? 'Fixing…' : `Fix & save all (${fixableCount})`}
                </button>
              </div>
              <label className="batch-ai" title="Hide levels the straightforward player already clears">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.target.checked)}
                />
                Only levels with traps ({issueCount})
              </label>
            </div>

            <div className="batch-rows">
              {visible.length === 0 ? (
                <div className="editor-empty">No order traps. 🎉</div>
              ) : (
                visible.map((row) => {
                  const isOpen = expanded.has(row.name);
                  const expandable = row.status === 'trap-fixed' || row.status === 'trap-unfixable';
                  return (
                    <div key={row.name}>
                      <div className={`batch-row${row.status === 'error' ? ' bad' : ''}`}>
                        <button
                          className="batch-chevron"
                          onClick={() => expandable && toggleExpand(row.name)}
                          disabled={!expandable}
                        >
                          {expandable ? (isOpen ? '▼' : '▶') : ''}
                        </button>
                        <span className="batch-row-name">{row.name}</span>
                        {row.status === 'error' && <span className="batch-row-error">{row.error}</span>}
                        {row.status === 'fair' && <span className="batch-tag">ok</span>}
                        {row.status === 'trap-fixed' && (
                          <span className="batch-badge warn">
                            trap @ move {row.before?.movesUsed} — reorder fixes
                          </span>
                        )}
                        {row.status === 'trap-unfixable' && (
                          <span className="batch-badge bad">trap — reorder can't fix</span>
                        )}
                        {row.status === 'trap-fixed' && (
                          <button
                            className="editor-btn small primary"
                            onClick={() => saveLevel(row)}
                            disabled={!!busy}
                            title="Reorder this level's stock and write it back"
                          >
                            {busy === row.name ? 'Saving…' : 'Fix & save'}
                          </button>
                        )}
                      </div>
                      {expandable && isOpen && (
                        <div className="batch-cats">
                          {row.status === 'trap-unfixable' && row.reason && (
                            <div className="warn-row warn-info">{row.reason}</div>
                          )}
                          {row.before && (
                            <div className="reorder-diag">
                              softlock after {row.before.movesUsed} moves
                              {row.before.deadLockedCategories.length > 0 &&
                                ` · dead-locked: ${row.before.deadLockedCategories.join(', ')}`}
                              {row.before.starvedCategories.length > 0 &&
                                ` · starved: ${row.before.starvedCategories.join(', ')}`}
                            </div>
                          )}
                          <div className="reorder-stock-line">
                            <span className="reorder-stock-label">before</span>
                            <code className="reorder-stock">{row.beforeStock.join(' ')}</code>
                          </div>
                          {row.afterStock && (
                            <div className="reorder-stock-line">
                              <span className="reorder-stock-label">after</span>
                              <code className="reorder-stock changed">{row.afterStock.join(' ')}</code>
                            </div>
                          )}
                          <div className="reorder-stock-hint">
                            stock shown in array order — first drawn is on the right
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="range-footer">
              <div className="range-status">
                <span>
                  {fixableCount} fixable · {issueCount} with traps · {plan.length} total
                </span>
                {savedNote && <span className="range-ok">{savedNote}</span>}
                {error && <span className="range-bad">{error}</span>}
              </div>
              <div className="range-actions">
                <button className="editor-btn primary" onClick={onClose} disabled={!!busy}>Done</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
