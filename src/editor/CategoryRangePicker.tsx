import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react';
import { generateWords, wordGenAvailable } from './wordGen';
import { CATEGORY_LIST, buildGenRequests, computeAssignments } from './rangeAssign';
import type { EditorAction, RangeAssignment, SkeletonCategory } from './types';

const LIST = CATEGORY_LIST;

interface Props {
  categories: SkeletonCategory[];
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}

export function CategoryRangePicker({ categories, dispatch, onClose }: Props) {
  const slotCount = categories.length;
  const maxStart = Math.max(0, LIST.length - slotCount);
  const [startIndex, setStartIndex] = useState(0);
  // Bumped after a generation run so the memo re-reads the localStorage cache.
  const [cacheVersion, setCacheVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const clamp = useCallback((n: number) => Math.max(0, Math.min(maxStart, n | 0)), [maxStart]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const previews = useMemo(
    () => computeAssignments(categories, startIndex),
    // cacheVersion is a deliberate dep: generation mutates the localStorage cache.
    [categories, startIndex, cacheVersion],
  );

  const outOfRange = previews.some((p) => !p.inRange);
  const duplicates = previews.filter((p) => p.duplicate);
  const shortSlots = previews.filter((p) => p.inRange && p.shortfall > 0);
  const totalShortfall = shortSlots.reduce((n, p) => n + p.shortfall, 0);
  const distinctShortNames = new Set(shortSlots.map((p) => p.categoryId)).size;
  const applyDisabled = outOfRange || duplicates.length > 0 || totalShortfall > 0;

  function randomize() {
    setStartIndex(Math.floor(Math.random() * (maxStart + 1)));
  }

  async function handleGenerate() {
    if (shortSlots.length === 0) return;
    setGenerating(true);
    setGenError(null);
    try {
      await generateWords(buildGenRequests(previews));
      setCacheVersion((v) => v + 1);
    } catch (e) {
      setGenError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  }

  function handleApply() {
    if (applyDisabled) return;
    const assignments: RangeAssignment[] = previews.map((p) => ({
      letter: p.letter,
      categoryId: p.categoryId,
      words: p.chosen.slice(0, p.simpleCards),
    }));
    dispatch({ type: 'APPLY_CATEGORY_RANGE', assignments });
    onClose();
  }

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-modal range-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>
            Fill {slotCount} categor{slotCount === 1 ? 'y' : 'ies'} from the list
          </span>
          <span className="picker-constraint">{LIST.length.toLocaleString()} entries</span>
          <button className="editor-btn small" onClick={onClose}>×</button>
        </div>

        <div className="range-controls">
          <button
            className="editor-btn small"
            onClick={() => setStartIndex((i) => clamp(i - 1))}
            disabled={startIndex <= 0}
            title="Previous index"
          >
            ◂
          </button>
          <label className="range-index">
            index
            <input
              className="editor-input small"
              type="number"
              min={0}
              max={maxStart}
              value={startIndex}
              onChange={(e) => setStartIndex(clamp(Number(e.target.value)))}
            />
          </label>
          <button
            className="editor-btn small"
            onClick={() => setStartIndex((i) => clamp(i + 1))}
            disabled={startIndex >= maxStart}
            title="Next index"
          >
            ▸
          </button>
          <input
            className="range-slider"
            type="range"
            min={0}
            max={maxStart}
            value={startIndex}
            onChange={(e) => setStartIndex(clamp(Number(e.target.value)))}
          />
          <button className="editor-btn small" onClick={randomize} title="Random start index">
            🎲 Random
          </button>
          <span className="range-window-label">
            {startIndex}–{startIndex + slotCount - 1} of {maxStart + slotCount - 1}
          </span>
        </div>

        <div className="range-rows">
          {previews.map((p) => (
            <div key={p.letter} className={`range-slot${p.duplicate ? ' dup' : ''}`}>
              <div className="range-slot-head">
                <span className="cat-letter">{p.letter}</span>
                <span className="range-slot-name">
                  {p.inRange ? p.categoryId : <span className="range-oob">out of range</span>}
                </span>
                <span className="range-slot-meta">#{p.listIndex}</span>
                <span
                  className={`range-slot-count${p.shortfall > 0 ? ' short' : ''}`}
                  title="words chosen / words needed"
                >
                  {p.chosen.length}/{p.simpleCards}
                </span>
              </div>
              <div className="range-slot-words">
                {p.chosen.map((w, j) => (
                  <span key={`w-${j}`} className={`range-word${p.generated[j] ? ' gen' : ''}`}>
                    {p.generated[j] ? '✦ ' : ''}
                    {w}
                  </span>
                ))}
                {Array.from({ length: p.shortfall }).map((_, j) => (
                  <span key={`m-${j}`} className="range-word missing">
                    needed
                  </span>
                ))}
                {p.simpleCards === 0 && <span className="range-empty-note">category card only</span>}
              </div>
              {p.duplicate && (
                <div className="range-slot-warn">Duplicate of an earlier slot — nudge the index.</div>
              )}
            </div>
          ))}
        </div>

        <div className="range-footer">
          <div className="range-status">
            {outOfRange && <span className="range-bad">Range runs past the end of the list.</span>}
            {duplicates.length > 0 && (
              <span className="range-bad">{duplicates.length} duplicate categor{duplicates.length === 1 ? 'y' : 'ies'} in range.</span>
            )}
            {totalShortfall > 0 && (
              <span className="range-warn-text">
                {totalShortfall} word{totalShortfall === 1 ? '' : 's'} missing across {distinctShortNames} categor{distinctShortNames === 1 ? 'y' : 'ies'}.
              </span>
            )}
            {!applyDisabled && <span className="range-ok">Ready — every word resolved.</span>}
            {genError && <span className="range-bad">Generate: {genError}</span>}
          </div>
          <div className="range-actions">
            {wordGenAvailable && totalShortfall > 0 && (
              <button className="editor-btn" onClick={handleGenerate} disabled={generating}>
                {generating ? 'Generating…' : `Generate missing (${distinctShortNames})`}
              </button>
            )}
            <button className="editor-btn" onClick={onClose}>Cancel</button>
            <button
              className="editor-btn primary"
              onClick={handleApply}
              disabled={applyDisabled}
              title={applyDisabled ? 'Resolve duplicates / missing words first.' : 'Lock these categories and words into the level.'}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
