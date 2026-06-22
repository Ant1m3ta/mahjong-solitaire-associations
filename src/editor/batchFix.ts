import type { CategoryData, LevelData } from '../types';
import type { SkeletonLevel } from './types';
import type { LevelFileEntry } from './save';
import { unfillLevel, UnfillError } from './unfill';
import { fillSkeleton, FillError } from './fill';
import { computeAssignments, type SlotPreview } from './rangeAssign';
import { overridesForLevel } from './batchFill';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// A category whose every card renders as a picture. Its image tokens are valid
// "words" (they live in the image catalog, not the text catalog), so the Fix
// tool must treat the slot as already filled — never a gap, never re-rolled to
// text on save. Mirrors imageSwap.ts's origIsImage test.
function isImageCategory(cat: CategoryData): boolean {
  return cat.wordsData.length > 0 && cat.wordsData.every((w) => w.icon);
}

// One level's fix state: its existing categories resolved against the current
// catalog (so gaps reflect what's still missing right now), plus whether the
// file carries base-fill placeholder markers.
export interface FixRow {
  name: string;
  status: 'ok' | 'error';
  error?: string;
  level: LevelData;
  skeleton?: SkeletonLevel;
  previews: SlotPreview[];
  // Letters (A, B, …) of categories that render as pictures — kept verbatim,
  // excluded from the text-catalog shortfall.
  imageLetters: Set<string>;
  gapCount: number;
  duplicateCount: number;
  fileIncomplete: boolean;
}

export function buildFixPlan(
  entries: LevelFileEntry[],
  overrides: Record<string, string> = {},
): FixRow[] {
  return entries.map((entry) => {
    let skeleton: SkeletonLevel;
    try {
      skeleton = unfillLevel(entry.level);
    } catch (e) {
      return {
        name: entry.name,
        status: 'error',
        error: e instanceof UnfillError ? e.message : String(e),
        level: entry.level,
        previews: [],
        imageLetters: new Set(),
        gapCount: 0,
        duplicateCount: 0,
        fileIncomplete: false,
      };
    }
    const imageLetters = new Set<string>();
    entry.level.categories.forEach((c, i) => {
      if (isImageCategory(c)) imageLetters.add(LETTERS[i]);
    });
    // Base each slot on the level's existing category; an override replaces it.
    const baseNames = skeleton.categories.map((c) => c.pinnedCategoryId);
    const previews = computeAssignments(
      skeleton.categories,
      0,
      overridesForLevel(overrides, entry.name),
      baseNames,
    );
    // Image categories are satisfied by their pictures — clear any text-catalog
    // shortfall so they are not flagged as gaps or sent for generation.
    for (const p of previews) {
      if (imageLetters.has(p.letter)) p.shortfall = 0;
    }
    // An imaged word never carries `missing`, but guard the marker too.
    const fileIncomplete = entry.level.categories.some(
      (c, i) =>
        !imageLetters.has(LETTERS[i]) &&
        (c.incomplete || c.wordsData.some((w) => w.missing)),
    );
    return {
      name: entry.name,
      status: 'ok',
      level: entry.level,
      skeleton,
      previews,
      imageLetters,
      gapCount: previews.reduce((n, p) => n + p.shortfall, 0),
      duplicateCount: previews.filter((p) => p.duplicate).length,
      fileIncomplete,
    };
  });
}

// Re-fill a level from its (possibly fixed) category assignment. padGaps keeps
// it writable even if some gaps remain — those re-mark as placeholders.
export function fillFixRow(row: FixRow): LevelData {
  if (row.status !== 'ok' || !row.skeleton) {
    throw new FillError(row.error ?? 'row not fixable');
  }
  const { skeleton } = row;
  const dup = row.previews.find((p) => p.duplicate);
  if (dup) {
    throw new FillError(`duplicate category "${dup.categoryId}"`);
  }
  const byLetter = new Map(row.previews.map((p) => [p.letter, p]));
  const categories = skeleton.categories.map((c) => {
    const p = byLetter.get(c.letter);
    return p ? { ...c, pinnedCategoryId: p.categoryId, pinnedWords: p.chosen } : c;
  });
  const filled = fillSkeleton({ ...skeleton, categories }, { padGaps: true });

  // Image categories aren't in the text catalog, so fillSkeleton re-rolls them
  // to text words. Splice the originals back: the category data plus every
  // board/stock cardId that points into an image category. Order is 1:1 —
  // unfill keeps category, board and stock positions, so index i ↔ LETTERS[i]
  // ↔ the original entry.
  if (row.imageLetters.size > 0) {
    const orig = row.level;
    filled.categories = filled.categories.map((c, i) =>
      row.imageLetters.has(LETTERS[i]) ? orig.categories[i] : c,
    );
    filled.board = filled.board.map((b, j) =>
      row.imageLetters.has(skeleton.board[j].letter) ? { ...b, cardId: orig.board[j].cardId } : b,
    );
    filled.stock = filled.stock.map((s, j) =>
      row.imageLetters.has(skeleton.stock[j].letter) ? orig.stock[j] : s,
    );
  }
  return filled;
}
