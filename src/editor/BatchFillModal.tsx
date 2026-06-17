import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_LIST } from './rangeAssign';
import { buildPlan, collectGenRequests, fillRow, overrideKey } from './batchFill';
import { generateWords, wordGenAvailable } from './wordGen';
import { pools } from './fill';
import { saveLevelJSON, type LevelFileEntry } from './save';
import type { SlotPreview } from './rangeAssign';
import type { BatchRow } from './batchFill';

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

const GEN_CHUNK = 20;

export function BatchFillModal({ entries, needsFolder, boundFolder, onPickFolder, onWrote, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((e) => e.name)));
  const [aiEnabled, setAiEnabled] = useState(false);
  const [planVersion, setPlanVersion] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'writing' | 'done'>('idle');
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Write range, as positions among the selected (sequence) files. `to` starts
  // at a sentinel so the default is "through the last level".
  const [writeFrom, setWriteFrom] = useState(0);
  const [writeTo, setWriteTo] = useState(Number.MAX_SAFE_INTEGER);
  // Per-slot category replacements, keyed overrideKey(levelName, letter).
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Keep the selection + range in sync if the folder listing changes underneath us.
  useEffect(() => {
    setSelected(new Set(entries.map((e) => e.name)));
    setWriteFrom(0);
    setWriteTo(Number.MAX_SAFE_INTEGER);
    setOverrides({});
  }, [entries]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'generating' && phase !== 'writing') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  // Range positions index into the full file list (every level counts toward
  // the category index regardless of selection).
  const lastPos = Math.max(0, entries.length - 1);
  const rangeFrom = Math.min(Math.max(0, writeFrom), lastPos);
  const rangeTo = Math.min(Math.max(rangeFrom, writeTo), lastPos);

  const plan = useMemo(
    () => buildPlan(entries, selected, { from: rangeFrom, to: rangeTo }, overrides),
    // planVersion bumps after generation so previews re-read the word cache.
    [entries, selected, rangeFrom, rangeTo, overrides, planVersion],
  );

  const writeRows = plan.filter((r) => r.willWrite); // selected, valid, in range
  const countOnlyRows = plan.filter((r) => r.status === 'ok' && !r.willWrite);
  const errorInRange = plan.filter(
    (r) => r.status === 'error' && r.selected && r.seqPos >= rangeFrom && r.seqPos <= rangeTo,
  );
  const totalCategories = writeRows.reduce((n, r) => n + r.categoryCount, 0);
  const totalGaps = writeRows.reduce((n, r) => n + r.gapCount, 0);
  const gapCategories = collectGenRequests(writeRows).length;
  const dupRows = writeRows.filter((r) => r.duplicateCount > 0).length;
  const firstIndex = writeRows.reduce((m, r) => Math.min(m, r.startIndex), Number.MAX_SAFE_INTEGER);
  const lastIndex = writeRows.reduce((m, r) => Math.max(m, r.startIndex + r.categoryCount - 1), -1);
  const running = phase === 'generating' || phase === 'writing';
  const overflow = lastIndex >= CATEGORY_LIST.length;
  // What will actually be written: no in-window duplicate, and either no gaps
  // or AI is on to fill them. Levels with gaps + AI off are skipped by fillRow.
  const writableRows = writeRows.filter(
    (r) => r.duplicateCount === 0 && (aiEnabled || r.gapCount === 0),
  );
  const willSkip = writeRows.length - writableRows.length;

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

  // Swap a slot's category for a random catalog category that has enough words
  // and isn't already used in that level — for finite categories (e.g. Days)
  // that can't be extended by generation.
  function replaceCategory(row: BatchRow, p: SlotPreview) {
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

  function clearOverride(row: BatchRow, p: SlotPreview) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[overrideKey(row.name, p.letter)];
      return next;
    });
  }

  async function run() {
    setError(null);
    setResults([]);
    try {
      if (aiEnabled) {
        const reqs = collectGenRequests(writeRows);
        if (reqs.length > 0) {
          setPhase('generating');
          for (let i = 0; i < reqs.length; i += GEN_CHUNK) {
            setProgress(`Generating words… ${Math.min(i + GEN_CHUNK, reqs.length)}/${reqs.length} categories`);
            await generateWords(reqs.slice(i, i + GEN_CHUNK));
          }
          setPlanVersion((v) => v + 1);
        }
      }
      // Fresh plan so previews reflect any words just generated.
      const fresh = buildPlan(entries, selected, { from: rangeFrom, to: rangeTo }, overrides);
      setPhase('writing');
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
          res.push({
            name: row.name,
            ok: true,
            detail: `#${row.startIndex}–${row.startIndex + row.categoryCount - 1} · ${row.categoryCount} cats`,
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
  const unsupported = !needsFolder; // no File System Access API → can't write in place
  const wroteOk = results.filter((r) => r.ok).length;
  const wroteFail = results.length - wroteOk;
  const skippedForGaps = !aiEnabled && totalGaps > 0;

  return (
    <div className="picker-overlay" onClick={() => !running && onClose()}>
      <div className="picker-modal batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>Fill levels from list</span>
          <span className="picker-constraint">{CATEGORY_LIST.length.toLocaleString()} entries</span>
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
              <label className={`batch-ai${wordGenAvailable ? '' : ' disabled'}`} title={wordGenAvailable ? 'Generate missing words via the local claude CLI' : 'Word generation only works under `npm run dev`.'}>
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  disabled={running || !wordGenAvailable}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                />
                Generate missing words with AI
              </label>
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
                          {row.willWrite && row.gapCount > 0 && <span className="batch-badge warn">{row.gapCount} to gen</span>}
                        </>
                      )}
                      {row.selected && row.status === 'error' && (
                        <span className="batch-row-error">{row.error}</span>
                      )}
                    </div>
                    {expandable && isOpen && (
                      <div className="batch-cats">
                        {row.previews.map((p) => (
                          <div className="batch-cat" key={p.letter}>
                            <div className="batch-cat-head">
                              <span className="cat-letter">{p.letter}</span>
                              <span className="batch-cat-name">
                                {p.categoryId || <span className="range-oob">out of range</span>}
                              </span>
                              {p.overridden && <span className="batch-tag">replaced</span>}
                              {p.duplicate && <span className="batch-badge bad">dup</span>}
                              <span className={`batch-cat-count${p.shortfall > 0 ? ' short' : ''}`}>
                                {p.chosen.length}/{p.simpleCards}
                              </span>
                              {(p.shortfall > 0 || p.overridden) && (
                                <button
                                  className="editor-btn small"
                                  onClick={() => replaceCategory(row, p)}
                                  disabled={running}
                                  title="Replace with a random catalog category that has enough words"
                                >
                                  ↻ replace
                                </button>
                              )}
                              {p.overridden && (
                                <button
                                  className="editor-btn small"
                                  onClick={() => clearOverride(row, p)}
                                  disabled={running}
                                  title="Restore the category from the list at this index"
                                >
                                  reset
                                </button>
                              )}
                            </div>
                            <div className="batch-cat-words">
                              {p.chosen.map((w, j) => (
                                <span key={`w-${j}`} className={`range-word${p.generated[j] ? ' gen' : ''}`}>
                                  {p.generated[j] ? '✦ ' : ''}
                                  {w}
                                </span>
                              ))}
                              {Array.from({ length: p.shortfall }).map((_, j) => (
                                <span key={`m-${j}`} className="range-word missing">needed</span>
                              ))}
                              {p.simpleCards === 0 && <span className="range-empty-note">category card only</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="range-footer">
              <div className="range-status">
                <span>
                  Writing {writeRows.length} level{writeRows.length === 1 ? '' : 's'} · {totalCategories} categories · indexes {writeRows.length > 0 ? `${firstIndex}–${Math.max(0, lastIndex)}` : '—'}
                  {countOnlyRows.length > 0 && ` (${countOnlyRows.length} other level${countOnlyRows.length === 1 ? '' : 's'} counted for indexing)`}
                </span>
                {overflow && <span className="range-bad">Range exceeds the {CATEGORY_LIST.length.toLocaleString()}-entry list.</span>}
                {errorInRange.length > 0 && <span className="range-bad">{errorInRange.length} file(s) in range can’t be read and will be skipped.</span>}
                {dupRows > 0 && <span className="range-warn-text">{dupRows} level(s) hit a duplicate category and will be skipped — use ↻ replace.</span>}
                {totalGaps > 0 && (
                  aiEnabled
                    ? <span className="range-warn-text">Will generate {totalGaps} word(s) across {gapCategories} categor{gapCategories === 1 ? 'y' : 'ies'} (~{Math.ceil(gapCategories / GEN_CHUNK)} AI call(s)).</span>
                    : <span className="range-warn-text">{skippedForGaps ? `${writeRows.filter((r) => r.gapCount > 0).length} in-range level(s) have word gaps and will be skipped — enable “Generate missing words with AI” to fill them.` : ''}</span>
                )}
                {writableRows.length === 0 && writeRows.length > 0 && (
                  <span className="range-bad">Nothing to write — all {writeRows.length} in-range level(s) would be skipped. {aiEnabled ? 'Resolve duplicates with ↻ replace.' : 'Turn on AI generation, or use ↻ replace.'}</span>
                )}
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
                  {running
                    ? 'Working…'
                    : `Run — write ${writableRows.length} file${writableRows.length === 1 ? '' : 's'}${willSkip > 0 ? ` (${willSkip} skipped)` : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
