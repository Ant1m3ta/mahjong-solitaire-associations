import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_LIST } from './rangeAssign';
import { buildPlan, collectGenRequests, fillRow } from './batchFill';
import { generateWords, wordGenAvailable } from './wordGen';
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

const GEN_CHUNK = 20;

export function BatchFillModal({ entries, needsFolder, boundFolder, onPickFolder, onWrote, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((e) => e.name)));
  const [aiEnabled, setAiEnabled] = useState(false);
  const [planVersion, setPlanVersion] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'writing' | 'done'>('idle');
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep the selection in sync if the folder listing changes underneath us.
  useEffect(() => {
    setSelected(new Set(entries.map((e) => e.name)));
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

  const plan = useMemo(
    () => buildPlan(entries, selected),
    // planVersion bumps after generation so previews re-read the word cache.
    [entries, selected, planVersion],
  );

  const selectedRows = plan.filter((r) => r.selected);
  const okRows = selectedRows.filter((r) => r.status === 'ok');
  const errorRows = selectedRows.filter((r) => r.status === 'error');
  const totalCategories = okRows.reduce((n, r) => n + r.categoryCount, 0);
  const totalGaps = okRows.reduce((n, r) => n + r.gapCount, 0);
  const gapCategories = collectGenRequests(plan).length;
  const dupRows = okRows.filter((r) => r.duplicateCount > 0).length;
  const lastIndex = okRows.reduce((m, r) => Math.max(m, r.startIndex + r.categoryCount - 1), -1);
  const running = phase === 'generating' || phase === 'writing';
  const overflow = lastIndex >= CATEGORY_LIST.length;

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

  async function run() {
    setError(null);
    setResults([]);
    try {
      if (aiEnabled) {
        const reqs = collectGenRequests(plan);
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
      const fresh = buildPlan(entries, selected);
      setPhase('writing');
      const res: RunResult[] = [];
      for (const row of fresh) {
        if (!row.selected) continue;
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
          <span>Fill all levels from list</span>
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

            <div className="batch-rows">
              {plan.map((row) => (
                <label key={row.name} className={`batch-row${row.selected ? '' : ' off'}${row.status === 'error' ? ' bad' : ''}`}>
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={running}
                    onChange={() => toggle(row.name)}
                  />
                  <span className="batch-row-name">{row.name}</span>
                  {row.selected && row.status === 'ok' && (
                    <>
                      <span className="batch-row-range">
                        #{row.startIndex}–{row.startIndex + row.categoryCount - 1}
                      </span>
                      <span className="batch-row-cats">{row.categoryCount} cats</span>
                      {row.duplicateCount > 0 && <span className="batch-badge bad">{row.duplicateCount} dup</span>}
                      {row.gapCount > 0 && <span className="batch-badge warn">{row.gapCount} to gen</span>}
                    </>
                  )}
                  {row.selected && row.status === 'error' && (
                    <span className="batch-row-error">{row.error}</span>
                  )}
                </label>
              ))}
            </div>

            <div className="range-footer">
              <div className="range-status">
                <span>
                  {okRows.length} level{okRows.length === 1 ? '' : 's'} · {totalCategories} categories · indexes 0–{Math.max(0, lastIndex)}
                </span>
                {overflow && <span className="range-bad">Range exceeds the {CATEGORY_LIST.length.toLocaleString()}-entry list.</span>}
                {errorRows.length > 0 && <span className="range-bad">{errorRows.length} file(s) can’t be read and will be skipped.</span>}
                {dupRows > 0 && <span className="range-warn-text">{dupRows} level(s) hit a duplicate category and will be skipped.</span>}
                {totalGaps > 0 && (
                  aiEnabled
                    ? <span className="range-warn-text">Will generate {totalGaps} word(s) across {gapCategories} categor{gapCategories === 1 ? 'y' : 'ies'} (~{Math.ceil(gapCategories / GEN_CHUNK)} AI call(s)).</span>
                    : <span className="range-warn-text">{skippedForGaps ? `${okRows.filter((r) => r.gapCount > 0).length} level(s) have word gaps and will be skipped (enable AI to fill them).` : ''}</span>
                )}
                {running && <span className="range-warn-text">{progress}</span>}
                {error && <span className="range-bad">{error}</span>}
              </div>
              <div className="range-actions">
                <button className="editor-btn" onClick={onClose} disabled={running}>Cancel</button>
                <button
                  className="editor-btn primary"
                  onClick={run}
                  disabled={running || okRows.length === 0 || overflow}
                  title="Overwrite each selected level file with categories drawn from the list at its computed index."
                >
                  {running ? 'Working…' : `Run — write ${okRows.length} file${okRows.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
