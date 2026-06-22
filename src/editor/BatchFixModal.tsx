import { useEffect, useMemo, useState } from 'react';
import { buildFixPlan, fillFixRow, type FixRow } from './batchFix';
import { overrideKey, overridesForLevel } from './batchFill';
import { buildGenRequests, type SlotPreview } from './rangeAssign';
import { generateWords, wordGenAvailable } from './wordGen';
import { pools } from './fill';
import { saveLevelJSON, type LevelFileEntry } from './save';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Words a category already holds in the file (excluding placeholder stubs), so
// the modal can flag which preview words are NEW — the ones a save will write in
// place of a `(needs word N)` stub (or the whole vocabulary of a replaced one).
function fileRealWords(row: FixRow, letter: string): Set<string> {
  const cat = row.level.categories[LETTERS.indexOf(letter)];
  if (!cat) return new Set();
  return new Set(cat.wordsData.filter((w) => !w.missing).map((w) => w.wordId.toLowerCase()));
}

interface Props {
  entries: LevelFileEntry[];
  needsFolder: boolean;
  boundFolder: string | null;
  onPickFolder: () => void;
  onWrote: () => void;
  onClose: () => void;
}

export function BatchFixModal({ entries, needsFolder, boundFolder, onPickFolder, onWrote, onClose }: Props) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [version, setVersion] = useState(0); // bump to re-read catalog after generation
  const [busy, setBusy] = useState<string | null>(null); // levelName currently generating/saving
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

  const plan = useMemo(
    () => buildFixPlan(entries, overrides),
    [entries, overrides, version],
  );

  const needsFix = (r: FixRow) => r.status === 'error' || r.gapCount > 0 || r.fileIncomplete;
  const issueCount = plan.filter(needsFix).length;
  const visible = onlyIssues ? plan.filter(needsFix) : plan;

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function replaceCategory(row: FixRow, p: SlotPreview) {
    const usedInLevel = new Set(row.previews.map((x) => x.categoryId.toLowerCase()));
    const candidates = pools().all.filter(
      (c) => c.wordsIds.length >= p.simpleCards && !usedInLevel.has(c.categoryId.toLowerCase()),
    );
    if (candidates.length === 0) {
      setError(`No catalog category has ≥ ${p.simpleCards} words to replace "${p.categoryId}".`);
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    setError(null);
    setOverrides((prev) => ({ ...prev, [overrideKey(row.name, p.letter)]: pick.categoryId }));
  }

  function clearOverride(row: FixRow, p: SlotPreview) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[overrideKey(row.name, p.letter)];
      return next;
    });
  }

  async function generateLevel(row: FixRow) {
    const reqs = buildGenRequests(row.previews, 2);
    if (reqs.length === 0) return;
    setBusy(row.name);
    setError(null);
    setSavedNote(null);
    try {
      await generateWords(reqs);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function saveLevel(row: FixRow) {
    setBusy(row.name);
    setError(null);
    setSavedNote(null);
    try {
      const level = fillFixRow(row);
      await saveLevelJSON(level, row.name);
      setSavedNote(`Saved ${row.name}.`);
      onWrote();
    } catch (e) {
      setError(`${row.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  // A save changes the file when it can cleanly clear placeholder stubs
  // (gap-free + incomplete) or when the category was replaced via an override.
  // Levels with remaining gaps are excluded — they'd re-pad new placeholders.
  function willChange(r: FixRow): boolean {
    if (r.status !== 'ok' || r.duplicateCount > 0) return false;
    const overridden = Object.keys(overridesForLevel(overrides, r.name)).length > 0;
    return (r.gapCount === 0 && r.fileIncomplete) || overridden;
  }

  async function saveAllChanged() {
    const targets = plan.filter(willChange);
    if (targets.length === 0) return;
    setBusy('__all__');
    setError(null);
    setSavedNote(null);
    let saved = 0;
    try {
      for (const row of targets) {
        const level = fillFixRow(row);
        await saveLevelJSON(level, row.name);
        saved++;
        setSavedNote(`Saving… ${saved}/${targets.length}`);
      }
      setSavedNote(`Saved ${saved} level${saved === 1 ? '' : 's'}.`);
      onWrote();
    } catch (e) {
      setError(`Saved ${saved}/${targets.length}, then failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const changedCount = plan.filter(willChange).length;

  const needsPick = needsFolder && !boundFolder;
  const unsupported = !needsFolder;

  return (
    <div className="picker-overlay" onClick={() => !busy && onClose()}>
      <div className="picker-modal batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>Fix levels</span>
          <span className="picker-constraint">words &amp; categories</span>
          <button className="editor-btn small" onClick={onClose} disabled={!!busy}>×</button>
        </div>

        {unsupported ? (
          <div className="batch-body">
            <div className="warn-row warn-error">
              Fixing writes files in place via the File System Access API. Open the editor in
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
              </div>
              <label className="batch-ai" title="Hide levels that are already complete">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.target.checked)}
                />
                Only levels needing fixes ({issueCount})
              </label>
            </div>

            <div className="batch-rows">
              {visible.length === 0 ? (
                <div className="editor-empty">No levels need fixing. 🎉</div>
              ) : (
                visible.map((row) => {
                  const isOpen = expanded.has(row.name);
                  const expandable = row.status === 'ok';
                  const fix = expandable && row.gapCount > 0;
                  const ready = expandable && row.gapCount === 0 && row.fileIncomplete;
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
                        {fix && <span className="batch-badge warn">{row.gapCount} missing</span>}
                        {row.duplicateCount > 0 && <span className="batch-badge bad">{row.duplicateCount} dup</span>}
                        {ready && <span className="batch-badge">placeholders — save to clear</span>}
                        {expandable && !fix && !ready && row.duplicateCount === 0 && (
                          <span className="batch-tag">ok</span>
                        )}
                      </div>
                      {expandable && isOpen && (
                        <div className="batch-cats">
                          <div className="batch-fix-toolbar">
                            {wordGenAvailable && row.gapCount > 0 && (
                              <button
                                className="editor-btn small"
                                onClick={() => generateLevel(row)}
                                disabled={!!busy}
                                title="Generate the missing words for this level via the local claude CLI"
                              >
                                {busy === row.name ? 'Generating…' : `✦ Generate missing (${row.gapCount})`}
                              </button>
                            )}
                            <button
                              className="editor-btn small primary"
                              onClick={() => saveLevel(row)}
                              disabled={!!busy || row.duplicateCount > 0}
                              title="Write this level with the current words/categories"
                            >
                              {busy === row.name ? 'Saving…' : 'Save level'}
                            </button>
                          </div>
                          {row.previews.map((p) => {
                            const isImg = row.imageLetters.has(p.letter);
                            const existing = fileRealWords(row, p.letter);
                            return (
                            <div className="batch-cat" key={p.letter}>
                              <div className="batch-cat-head">
                                <span className="cat-letter">{p.letter}</span>
                                <span className="batch-cat-name">{p.categoryId}</span>
                                {isImg && <span className="batch-tag">🖼 images</span>}
                                {p.overridden && <span className="batch-tag">replaced</span>}
                                {p.duplicate && <span className="batch-badge bad">dup</span>}
                                {!isImg && (
                                  <span className={`batch-cat-count${p.shortfall > 0 ? ' short' : ''}`}>
                                    {p.chosen.length}/{p.simpleCards}
                                  </span>
                                )}
                                {!isImg && (p.shortfall > 0 || p.overridden) && (
                                  <button
                                    className="editor-btn small"
                                    onClick={() => replaceCategory(row, p)}
                                    disabled={!!busy}
                                    title="Replace with a random catalog category that has enough words"
                                  >
                                    ↻ replace
                                  </button>
                                )}
                                {p.overridden && (
                                  <button
                                    className="editor-btn small"
                                    onClick={() => clearOverride(row, p)}
                                    disabled={!!busy}
                                    title="Restore the level's original category"
                                  >
                                    reset
                                  </button>
                                )}
                              </div>
                              <div className="batch-cat-words">
                                {isImg ? (
                                  <span className="range-empty-note">
                                    {p.simpleCards} picture{p.simpleCards === 1 ? '' : 's'} — kept as-is
                                  </span>
                                ) : (
                                  <>
                                    {p.chosen.map((w, k) => {
                                      const isNew = !p.generated[k] && !existing.has(w.toLowerCase());
                                      const cls = p.generated[k] ? ' gen' : isNew ? ' fills' : '';
                                      return (
                                        <span
                                          key={`w-${k}`}
                                          className={`range-word${cls}`}
                                          title={
                                            p.generated[k]
                                              ? 'AI-generated'
                                              : isNew
                                                ? 'will be written in place of a placeholder'
                                                : undefined
                                          }
                                        >
                                          {p.generated[k] ? '✦ ' : isNew ? '＋ ' : ''}
                                          {w}
                                        </span>
                                      );
                                    })}
                                    {Array.from({ length: p.shortfall }).map((_, k) => (
                                      <span key={`m-${k}`} className="range-word missing">needs word</span>
                                    ))}
                                    {p.simpleCards === 0 && <span className="range-empty-note">category card only</span>}
                                  </>
                                )}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="range-footer">
              <div className="range-status">
                <span>{issueCount} of {plan.length} level{plan.length === 1 ? '' : 's'} need fixing</span>
                {savedNote && <span className="range-ok">{savedNote}</span>}
                {error && <span className="range-bad">{error}</span>}
              </div>
              <div className="range-actions">
                <button
                  className="editor-btn"
                  onClick={saveAllChanged}
                  disabled={!!busy || changedCount === 0}
                  title="Save every level whose placeholders can be cleared or whose category was replaced"
                >
                  {busy === '__all__' ? 'Saving all…' : `Save all changed (${changedCount})`}
                </button>
                <button className="editor-btn primary" onClick={onClose} disabled={!!busy}>Done</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
