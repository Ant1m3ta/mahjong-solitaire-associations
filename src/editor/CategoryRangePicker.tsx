import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react';
import categoryList from './catalog/category_list.json';
import { pools } from './fill';
import { cachedWordsFor, generateWords, wordGenAvailable, type GenRequest } from './wordGen';
import type { EditorAction, RangeAssignment, SkeletonCategory } from './types';

const LIST = categoryList as string[];

interface Props {
  categories: SkeletonCategory[];
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}

interface SlotPreview {
  letter: string;
  simpleCards: number;
  listIndex: number;
  inRange: boolean;
  categoryId: string;
  chosen: string[];
  generated: boolean[]; // parallel to chosen — true if the word came from AI, not the catalog
  shortfall: number;
  duplicate: boolean;
}

// Catalog ∪ AI cache for a name, deduped case-insensitively, catalog first.
function wordsForName(name: string): string[] {
  const pool = pools().byId.get(name)?.wordsIds ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...pool, ...cachedWordsFor(name)]) {
    const k = w.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(w);
    }
  }
  return out;
}

// Assign the next `categories.length` list entries (from startIndex) to the
// level's slots, choosing each slot's words deterministically and keeping every
// word unique across the whole window (the game resolver needs that).
function computeAssignments(categories: SkeletonCategory[], startIndex: number): SlotPreview[] {
  const reserved = new Set<string>(); // every window category name — words may not equal one
  for (let i = 0; i < categories.length; i++) {
    const name = LIST[startIndex + i];
    if (name !== undefined) reserved.add(name.toLowerCase());
  }

  const usedWords = new Set<string>();
  const seenNames = new Set<string>();
  const out: SlotPreview[] = [];

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const idx = startIndex + i;
    const name = LIST[idx];
    if (name === undefined) {
      out.push({
        letter: cat.letter,
        simpleCards: cat.simpleCards,
        listIndex: idx,
        inRange: false,
        categoryId: '',
        chosen: [],
        generated: [],
        shortfall: cat.simpleCards,
        duplicate: false,
      });
      continue;
    }
    const duplicate = seenNames.has(name.toLowerCase());
    seenNames.add(name.toLowerCase());

    const poolSet = new Set((pools().byId.get(name)?.wordsIds ?? []).map((w) => w.toLowerCase()));
    const chosen: string[] = [];
    const generated: boolean[] = [];
    for (const w of wordsForName(name)) {
      if (chosen.length >= cat.simpleCards) break;
      const k = w.toLowerCase();
      if (usedWords.has(k) || reserved.has(k)) continue;
      chosen.push(w);
      generated.push(!poolSet.has(k));
      usedWords.add(k);
    }
    out.push({
      letter: cat.letter,
      simpleCards: cat.simpleCards,
      listIndex: idx,
      inRange: true,
      categoryId: name,
      chosen,
      generated,
      shortfall: cat.simpleCards - chosen.length,
      duplicate,
    });
  }
  return out;
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
      const windowNames = previews.filter((p) => p.inRange).map((p) => p.categoryId);
      const allChosen = previews.flatMap((p) => p.chosen);
      const byName = new Map<string, GenRequest>();
      for (const p of shortSlots) {
        if (byName.has(p.categoryId)) continue;
        const avoid = Array.from(
          new Set([...wordsForName(p.categoryId), ...allChosen, ...windowNames]),
        );
        byName.set(p.categoryId, { categoryId: p.categoryId, count: p.shortfall, avoid });
      }
      await generateWords(Array.from(byName.values()));
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
