import { useEffect, useMemo, useState, type Dispatch } from 'react';
import type { LevelData } from '../types';
import type { EditorAction } from './types';
import { displayLetter, isPlaceholderCategory, simpleCounts } from './editorLevel';
import {
  describeImageSlots,
  ownImageCategory,
  TO_WORDS,
  type ImageSlot,
} from './imageSwap';
import { ImageSetPicker, OwnBadge, Thumb } from './ImagePickers';
import { CategoryPicker } from './CategoryPicker';
import { pools } from './fill';
import { generateWords, wordGenAvailable } from './wordGen';
import { wordsForName } from './rangeAssign';

// The current-level "Words & images" tool. Unlike the folder-batch Fix / Images
// tools, this edits ONLY the level loaded in the editor (state.level), applying
// each change live through the reducer so it is undoable (⌘Z) — no folder or
// File System Access API needed. Per category it can replace the category, roll
// fresh words (AI), or reskin it to pictures / back to words.

interface Props {
  level: LevelData;
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}

const isPlaceholderWord = (t: string): boolean => /^\(needs word \d+\)$/.test(t);

export function LevelContentModal({ level, dispatch, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null); // category index generating
  const [replaceFor, setReplaceFor] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<{ index: number; need: number } | null>(null);

  const slots = useMemo(() => describeImageSlots(level), [level]);
  const counts = useMemo(() => simpleCounts(level), [level]);
  const subOpen = replaceFor !== null || pickFor !== null;

  // How many of this level's slots already render each image category — feeds
  // the manual image-set picker's "used N×" hint.
  const usageByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots) if (s.isImage) m.set(s.categoryId, (m.get(s.categoryId) ?? 0) + 1);
    return m;
  }, [slots]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !subOpen && busy === null) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, subOpen, busy]);

  // The category's own image theme id (matched by normalized name) when it has
  // enough pictures, and whether the slot is already showing exactly that.
  function ownFor(slot: ImageSlot): { id: string | null; already: boolean } {
    const own = ownImageCategory(slot.categoryId, slot.distinctWords);
    return { id: own?.categoryId ?? null, already: slot.isImage && !slot.stale && own?.categoryId === slot.categoryId };
  }

  // Replace a category with a random catalog (text) category that has enough
  // words and isn't already used in this level. Applied immediately (undoable).
  function randomReplace(slot: ImageSlot) {
    const need = counts[slot.index];
    const used = new Set(level.categories.map((c) => c.categoryId.toLowerCase()));
    const cands = pools().all.filter(
      (p) => p.wordsIds.length >= need && !used.has(p.categoryId.toLowerCase()),
    );
    if (cands.length === 0) {
      setError(`No catalog category has ≥ ${need} word${need === 1 ? '' : 's'} and isn't already used.`);
      return;
    }
    const pick = cands[Math.floor(Math.random() * cands.length)];
    setError(null);
    setNote(`${slot.letter} → ${pick.categoryId} (random)`);
    dispatch({ type: 'SET_PINNED_CATEGORY', index: slot.index, categoryId: pick.categoryId });
  }

  function useOwn(slot: ImageSlot) {
    const { id } = ownFor(slot);
    if (!id) {
      setError(`${slot.categoryId} has no image set with ≥ ${slot.distinctWords} pictures.`);
      return;
    }
    setError(null);
    setNote(null);
    dispatch({ type: 'SET_CATEGORY_IMAGE', index: slot.index, target: id });
  }

  function toWords(slot: ImageSlot) {
    setError(null);
    setNote(null);
    dispatch({ type: 'SET_CATEGORY_IMAGE', index: slot.index, target: TO_WORDS });
  }

  // Every own-ready category that isn't already its own pictures → those pictures.
  function useOwnAll() {
    let any = false;
    for (const slot of slots) {
      const { id, already } = ownFor(slot);
      if (!id || already) continue;
      dispatch({ type: 'SET_CATEGORY_IMAGE', index: slot.index, target: id });
      any = true;
    }
    if (!any) {
      setError('No categories have their own images (with enough pictures) to apply.');
      return;
    }
    setError(null);
    setNote('Applied own images to every ready category.');
  }

  // Regenerate a text category's words with a fresh AI roll, keeping the same
  // category. Existing words anchor the sense; the current + cross-category words
  // and every category name are avoided so the roll is genuinely different and
  // stays level-unique. Applied via APPLY_CATEGORY_RANGE (words used verbatim).
  async function regenerate(slot: ImageSlot) {
    const index = slot.index;
    const categoryId = slot.categoryId;
    const count = counts[index];
    const cat = level.categories[index];
    const current = cat.wordsData.map((w) => w.wordId);
    const currentLc = new Set(current.map((w) => w.toLowerCase()));
    const others = new Set<string>();
    level.categories.forEach((c, i) => {
      others.add(c.categoryId.toLowerCase());
      if (i === index) return;
      for (const w of c.wordsData) others.add(w.wordId.toLowerCase());
    });
    const avoid = Array.from(
      new Set([
        ...current,
        ...level.categories.flatMap((c, i) => (i === index ? [] : c.wordsData.map((w) => w.wordId))),
        ...level.categories.map((c) => c.categoryId),
      ]),
    );
    setBusy(index);
    setError(null);
    setNote(null);
    try {
      await generateWords([{ categoryId, count, existing: current, avoid }]);
      const pool = wordsForName(categoryId).filter((w) => !others.has(w.toLowerCase()));
      const fresh = pool.filter((w) => !currentLc.has(w.toLowerCase()));
      const reuse = pool.filter((w) => currentLc.has(w.toLowerCase()));
      const chosen = [...fresh, ...reuse].slice(0, count);
      if (chosen.length === 0) {
        setError(`No usable words available for "${categoryId}".`);
        return;
      }
      dispatch({ type: 'APPLY_CATEGORY_RANGE', assignments: [{ index, categoryId, words: chosen }] });
      const short = count - chosen.length;
      setNote(
        short > 0
          ? `${displayLetter(index)}: applied ${chosen.length}/${count} — ${short} placeholder${short === 1 ? '' : 's'}`
          : `${displayLetter(index)}: regenerated ${chosen.length} word${chosen.length === 1 ? '' : 's'}`,
      );
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;

  return (
    <>
      <div className="picker-overlay" onClick={() => !anyBusy && onClose()}>
        <div className="picker-modal batch-modal" onClick={(e) => e.stopPropagation()}>
          <div className="picker-header">
            <span>Words &amp; images</span>
            <span className="picker-constraint">this level — live &amp; undoable (⌘Z)</span>
            <button className="editor-btn small" onClick={onClose} disabled={anyBusy}>×</button>
          </div>

          {level.categories.length === 0 ? (
            <div className="batch-body">
              <div className="editor-empty">This level has no categories.</div>
            </div>
          ) : (
            <>
              <div className="batch-controls">
                <span className="batch-ai">
                  Replace a category, roll fresh words, or swap tiles to pictures — applied to the
                  loaded level.
                </span>
                <button
                  className="editor-btn small"
                  onClick={useOwnAll}
                  disabled={anyBusy}
                  title="Set every category that has its own image set (with enough pictures) to those pictures."
                >
                  🖼 Use own images (all ready)
                </button>
              </div>

              <div className="level-content-list">
                {slots.map((slot) => {
                  const placeholder = isPlaceholderCategory(slot.categoryId);
                  const { id: ownId, already: ownAlready } = ownFor(slot);
                  const rollShort = slot.rollbackWords < slot.distinctWords;
                  return (
                    <div className="batch-cat" key={slot.index}>
                      <div className="batch-cat-head">
                        <span className="cat-letter">{slot.letter}</span>
                        <span className="batch-cat-name">{placeholder ? 'random' : slot.categoryId}</span>
                        {slot.isImage && !slot.stale && <span className="batch-tag">images</span>}
                        {slot.stale && <span className="batch-tag warn">stale</span>}
                        {placeholder && <span className="batch-tag">placeholder</span>}
                        <span className="batch-cat-count">
                          {slot.distinctWords} word{slot.distinctWords === 1 ? '' : 's'}
                        </span>
                        <OwnBadge slot={slot} />
                        <span className="batch-cat-actions">
                          <button
                            className="editor-btn small"
                            onClick={() => {
                              setError(null);
                              setNote(null);
                              setReplaceFor(slot.index);
                            }}
                            disabled={anyBusy}
                            title="Replace this category with a different catalog (text) category."
                          >
                            replace…
                          </button>
                          <button
                            className="editor-btn small"
                            onClick={() => randomReplace(slot)}
                            disabled={anyBusy}
                            title="Replace with a random catalog category that has enough words and isn't already used in this level."
                          >
                            random
                          </button>
                          {wordGenAvailable && (
                            <button
                              className="editor-btn small"
                              onClick={() => regenerate(slot)}
                              disabled={anyBusy || slot.isImage || placeholder || slot.distinctWords === 0}
                              title={
                                slot.isImage
                                  ? 'Roll back to words first (→ words), then regenerate.'
                                  : placeholder
                                    ? 'Theme this category first (replace…), then regenerate.'
                                    : 'Generate a fresh set of words for this category (AI).'
                              }
                            >
                              {busy === slot.index ? 'generating…' : 'regenerate words'}
                            </button>
                          )}
                          <button
                            className="editor-btn small"
                            onClick={() => useOwn(slot)}
                            disabled={anyBusy || !ownId || ownAlready || slot.distinctWords === 0}
                            title={
                              ownAlready
                                ? 'Already showing its own pictures.'
                                : ownId
                                  ? `Show this category as its own pictures (${ownId}).`
                                  : 'No image set for this category with enough pictures.'
                            }
                          >
                            use own
                          </button>
                          <button
                            className="editor-btn small"
                            onClick={() => {
                              setError(null);
                              setNote(null);
                              setPickFor({ index: slot.index, need: slot.distinctWords });
                            }}
                            disabled={anyBusy || slot.distinctWords === 0}
                            title="Pick any image set for this category."
                          >
                            pick…
                          </button>
                          {slot.isImage && (
                            <button
                              className="editor-btn small"
                              onClick={() => toWords(slot)}
                              disabled={anyBusy || rollShort}
                              title={
                                rollShort
                                  ? `Only ${slot.rollbackWords} text words available, need ${slot.distinctWords}.`
                                  : 'Roll back from pictures to text words.'
                              }
                            >
                              → words
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="img-thumbs">
                        {slot.isImage ? (
                          slot.imageIds.map((imageId, k) => <Thumb key={`${imageId}-${k}`} imageId={imageId} />)
                        ) : slot.distinctWords === 0 ? (
                          <span className="range-empty-note">category card only</span>
                        ) : (
                          slot.tokens.map((t, k) => (
                            <span key={`${t}-${k}`} className={`range-word${isPlaceholderWord(t) ? ' missing' : ''}`}>
                              {t}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="range-footer">
                <div className="range-status">
                  {note && <span className="range-ok">{note}</span>}
                  {error && <span className="range-bad">{error}</span>}
                  {!note && !error && <span className="dim">Changes apply immediately; undo with ⌘Z.</span>}
                </div>
                <div className="range-actions">
                  <button className="editor-btn primary" onClick={onClose} disabled={anyBusy}>
                    Done
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {replaceFor !== null && level.categories[replaceFor] && (
        <CategoryPicker
          index={replaceFor}
          category={level.categories[replaceFor]}
          minWords={counts[replaceFor] ?? 0}
          dispatch={dispatch}
          onClose={() => setReplaceFor(null)}
        />
      )}
      {pickFor && (
        <ImageSetPicker
          need={pickFor.need}
          usage={usageByCat}
          onPick={(id) => {
            dispatch({ type: 'SET_CATEGORY_IMAGE', index: pickFor.index, target: id });
            setPickFor(null);
          }}
          onClose={() => setPickFor(null)}
        />
      )}
    </>
  );
}
