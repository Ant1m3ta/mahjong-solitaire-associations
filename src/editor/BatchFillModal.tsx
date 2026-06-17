import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_LIST } from './rangeAssign';
import { buildPlan, fillRow } from './batchFill';
import { saveLevelJSON, type LevelFileEntry } from './save';

interface Props {
  entries: LevelFileEntry[];
  needsFolder: boolean;
  boundFolder: string | null;
  onPickFolder: () => void;
  onWrote: () => void;
  onClose: () => void;
}

interface RunResult {
  name: string;
  ok: boolean;
  detail: string;
}

// Normalize for comparing current vs proposed (handles icon snake_case vs
// Title Case, e.g. "bald_eagle" ≡ "Bald Eagle").
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function BatchFillModal({ entries, needsFolder, boundFolder, onPickFolder, onWrote, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((e) => e.name)));
  const [phase, setPhase] = useState<'idle' | 'writing' | 'done'>('idle');
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [writeFrom, setWriteFrom] = useState(0);
  const [writeTo, setWriteTo] = useState(Number.MAX_SAFE_INTEGER);

  useEffect(() => {
    setSelected(new Set(entries.map((e) => e.name)));
    setWriteFrom(0);
    setWriteTo(Number.MAX_SAFE_INTEGER);
  }, [entries]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'writing') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const lastPos = Math.max(0, entries.length - 1);
  const rangeFrom = Math.min(Math.max(0, writeFrom), lastPos);
  const rangeTo = Math.min(Math.max(rangeFrom, writeTo), lastPos);

  const plan = useMemo(
    () => buildPlan(entries, selected, { from: rangeFrom, to: rangeTo }),
    [entries, selected, rangeFrom, rangeTo],
  );

  const writeRows = plan.filter((r) => r.willWrite);
  const countOnlyRows = plan.filter((r) => r.status === 'ok' && !r.willWrite);
  const errorInRange = plan.filter(
    (r) => r.status === 'error' && r.selected && r.seqPos >= rangeFrom && r.seqPos <= rangeTo,
  );
  const levelByName = useMemo(() => new Map(entries.map((e) => [e.name, e.level])), [entries]);
  const totalCategories = writeRows.reduce((n, r) => n + r.categoryCount, 0);
  const firstIndex = writeRows.reduce((m, r) => Math.min(m, r.startIndex), Number.MAX_SAFE_INTEGER);
  const lastIndex = writeRows.reduce((m, r) => Math.max(m, r.startIndex + r.categoryCount - 1), -1);
  const overflow = lastIndex >= CATEGORY_LIST.length;
  // Gaps no longer block writing — only an in-window duplicate does.
  const writableRows = writeRows.filter((r) => r.duplicateCount === 0);
  const dupRows = writeRows.filter((r) => r.duplicateCount > 0).length;
  const gapLevels = writableRows.filter((r) => r.gapCount > 0).length;
  const running = phase === 'writing';

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function setAll(on: boolean) {
    setSelected(on ? new Set(entries.map((e) => e.name)) : new Set());
  }
  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function run() {
    setError(null);
    setResults([]);
    try {
      setPhase('writing');
      const fresh = buildPlan(entries, selected, { from: rangeFrom, to: rangeTo });
      const res: RunResult[] = [];
      for (const row of fresh) {
        const targeted = row.selected && row.seqPos >= rangeFrom && row.seqPos <= rangeTo;
        if (!targeted) continue;
        if (row.status !== 'ok') {
          res.push({ name: row.name, ok: false, detail: row.error ?? 'unreadable' });
          continue;
        }
        try {
          const level = fillRow(row);
          await saveLevelJSON(level, row.name);
          const gaps = row.gapCount;
          res.push({
            name: row.name,
            ok: true,
            detail:
              `#${row.startIndex}–${row.startIndex + row.categoryCount - 1} · ${row.categoryCount} cats` +
              (gaps > 0 ? ` · ${gaps} placeholder${gaps === 1 ? '' : 's'}` : ''),
          });
        } catch (e) {
          res.push({ name: row.name, ok: false, detail: e instanceof Error ? e.message : String(e) });
        }
        setProgress(`Writing… ${res.length}`);
      }
      setResults(res);
      setPhase('done');
      onWrote();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPhase('idle');
    }
  }

  const needsPick = needsFolder && !boundFolder;
  const unsupported = !needsFolder;
  const wroteOk = results.filter((r) => r.ok).length;
  const wroteFail = results.length - wroteOk;

  return (
    <div className="picker-overlay" onClick={() => !running && onClose()}>
      <div className="picker-modal batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>Fill levels from list</span>
          <span className="picker-constraint">base fill · {CATEGORY_LIST.length.toLocaleString()} entries</span>
          <button className="editor-btn small" onClick={onClose} disabled={running}>×</button>
        </div>

        {unsupported ? (
          <div className="batch-body">
            <div className="warn-row warn-error">
              Batch fill writes files in place via the File System Access API. Open the editor in
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
        ) : phase === 'done' ? (
          <>
            <div className="batch-body">
              <div className="batch-summary">
                Wrote <strong className="range-ok">{wroteOk}</strong> level{wroteOk === 1 ? '' : 's'}
                {wroteFail > 0 && <> · <strong className="range-bad">{wroteFail} skipped</strong></>}.
              </div>
              <div className="batch-rows">
                {results.map((r) => (
                  <div key={r.name} className={`batch-result${r.ok ? '' : ' bad'}`}>
                    <span className="batch-result-icon">{r.ok ? '✓' : '✗'}</span>
                    <span className="batch-result-name">{r.name}</span>
                    <span className="batch-result-detail">{r.detail}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="range-footer">
              <div className="range-status" />
              <div className="range-actions">
                <button className="editor-btn primary" onClick={onClose}>Done</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="batch-controls">
              <div className="batch-select-actions">
                <button className="editor-btn small" onClick={() => setAll(true)} disabled={running}>All</button>
                <button className="editor-btn small" onClick={() => setAll(false)} disabled={running}>None</button>
                <span className="batch-folder">→ {boundFolder}</span>
              </div>
              <span className="batch-hint">Gaps are written as placeholders — fix them in the Fix tool.</span>
            </div>

            {entries.length > 0 && (
              <div className="batch-range">
                <span className="batch-range-label">Write range</span>
                <select
                  className="level-select"
                  value={rangeFrom}
                  disabled={running}
                  onChange={(e) => setWriteFrom(Number(e.target.value))}
                  title="First level to (re)write. Earlier levels still count toward the category index."
                >
                  {plan.map((r, i) => (
                    <option key={r.name} value={i}>{i + 1}. {r.name}</option>
                  ))}
                </select>
                <span className="batch-range-to">to</span>
                <select
                  className="level-select"
                  value={rangeTo}
                  disabled={running}
                  onChange={(e) => setWriteTo(Number(e.target.value))}
                  title="Last level to (re)write."
                >
                  {plan.map((r, i) => i >= rangeFrom ? (
                    <option key={r.name} value={i}>{i + 1}. {r.name}</option>
                  ) : null)}
                </select>
                <span className="batch-range-count">
                  {writeRows.length} to write
                  {countOnlyRows.length > 0 && ` · ${countOnlyRows.length} counted for index`}
                </span>
              </div>
            )}

            <div className="batch-rows">
              {plan.map((row) => {
                const expandable = row.status === 'ok';
                const countOnly = expandable && !row.willWrite;
                const isOpen = expanded.has(row.name);
                return (
                  <div key={row.name}>
                    <div className={`batch-row${countOnly ? ' countonly' : ''}${row.status === 'error' ? ' bad' : ''}`}>
                      <button
                        className="batch-chevron"
                        onClick={() => expandable && toggleExpand(row.name)}
                        disabled={!expandable}
                        title={expandable ? 'Show this level’s categories and words' : ''}
                      >
                        {expandable ? (isOpen ? '▼' : '▶') : ''}
                      </button>
                      <label className="batch-row-main">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          disabled={running}
                          onChange={() => toggle(row.name)}
                        />
                        <span className="batch-row-name">{row.name}</span>
                      </label>
                      {expandable && (
                        <>
                          <span className="batch-row-range">
                            #{row.startIndex}–{row.startIndex + row.categoryCount - 1}
                          </span>
                          <span className="batch-row-cats">{row.categoryCount} cats</span>
                          {countOnly && <span className="batch-tag">index only</span>}
                          {row.willWrite && row.duplicateCount > 0 && <span className="batch-badge bad">{row.duplicateCount} dup</span>}
                          {row.willWrite && row.gapCount > 0 && <span className="batch-badge warn">{row.gapCount} placeholder{row.gapCount === 1 ? '' : 's'}</span>}
                        </>
                      )}
                      {row.selected && row.status === 'error' && (
                        <span className="batch-row-error">{row.error}</span>
                      )}
                    </div>
                    {expandable && isOpen && (
                      <div className="batch-cats">
                        {row.previews.map((p, j) => {
                          const cur = levelByName.get(row.name)?.categories[j];
                          const curId = cur?.categoryId ?? '';
                          const curWords = cur?.wordsData.map((w) => w.wordId) ?? [];
                          const curNorm = curWords.map(norm).sort();
                          const propNorm = p.chosen.map(norm).sort();
                          const same =
                            !!curId &&
                            norm(curId) === norm(p.categoryId) &&
                            curNorm.length === propNorm.length &&
                            curNorm.every((w, k) => w === propNorm[k]);
                          return (
                            <div className="batch-cat" key={p.letter}>
                              <div className="batch-cat-head">
                                <span className="cat-letter">{p.letter}</span>
                                {same ? (
                                  <span className="batch-cat-name">{p.categoryId}</span>
                                ) : (
                                  <span className="batch-cat-name">
                                    <span className="batch-cat-cur">{curId || '(none)'}</span>
                                    <span className="batch-cat-arrow"> → </span>
                                    <span className="batch-cat-new">
                                      {p.categoryId || <span className="range-oob">out of range</span>}
                                    </span>
                                  </span>
                                )}
                                {p.duplicate && <span className="batch-badge bad">dup</span>}
                                <span className={`batch-cat-count${p.shortfall > 0 ? ' short' : ''}`}>
                                  {p.chosen.length}/{p.simpleCards}
                                </span>
                              </div>
                              {!same && (
                                <div className="batch-cat-row">
                                  <span className="batch-cat-role">current</span>
                                  <div className="batch-cat-words">
                                    {curWords.length > 0 ? (
                                      curWords.map((w, k) => (
                                        <span key={`c-${k}`} className="range-word">{w}</span>
                                      ))
                                    ) : (
                                      <span className="range-empty-note">empty</span>
                                    )}
                                  </div>
                                </div>
                              )}
                              <div className="batch-cat-row">
                                {!same && <span className="batch-cat-role">#{p.listIndex}</span>}
                                <div className="batch-cat-words">
                                  {p.chosen.map((w, k) => (
                                    <span key={`w-${k}`} className={`range-word${p.generated[k] ? ' gen' : ''}`}>
                                      {p.generated[k] ? '✦ ' : ''}
                                      {w}
                                    </span>
                                  ))}
                                  {Array.from({ length: p.shortfall }).map((_, k) => (
                                    <span key={`m-${k}`} className="range-word missing">needs word</span>
                                  ))}
                                  {p.simpleCards === 0 && <span className="range-empty-note">category card only</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="range-footer">
              <div className="range-status">
                <span>
                  Writing {writableRows.length} level{writableRows.length === 1 ? '' : 's'} · {totalCategories} categories · indexes {writeRows.length > 0 ? `${firstIndex}–${Math.max(0, lastIndex)}` : '—'}
                  {countOnlyRows.length > 0 && ` (${countOnlyRows.length} other level${countOnlyRows.length === 1 ? '' : 's'} counted for indexing)`}
                </span>
                {overflow && <span className="range-bad">Range exceeds the {CATEGORY_LIST.length.toLocaleString()}-entry list.</span>}
                {dupRows > 0 && <span className="range-bad">{dupRows} level(s) hit a duplicate category and will be skipped.</span>}
                {errorInRange.length > 0 && <span className="range-bad">{errorInRange.length} file(s) in range can’t be read and will be skipped.</span>}
                {gapLevels > 0 && <span className="range-warn-text">{gapLevels} level(s) have missing words → written as placeholders; fix in the Fix tool.</span>}
                {running && <span className="range-warn-text">{progress}</span>}
                {error && <span className="range-bad">{error}</span>}
              </div>
              <div className="range-actions">
                <button className="editor-btn" onClick={onClose} disabled={running}>Cancel</button>
                <button
                  className="editor-btn primary"
                  onClick={run}
                  disabled={running || writableRows.length === 0 || overflow}
                  title="Overwrite each level in the write range with categories drawn from the list at its computed index."
                >
                  {running ? 'Working…' : `Run — write ${writableRows.length} file${writableRows.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
