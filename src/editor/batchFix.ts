import type { CategoryData, LevelData } from '../types';
import type { LevelFileEntry } from './save';
import { FillError } from './fill';
import { computeAssignments, type AssignSlot, type SlotPreview } from './rangeAssign';
import { rewriteCategories, simpleTileCounts, RewriteError } from './rewrite';
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
    let counts: number[];
    try {
      if (entry.level.categories.length > LETTERS.length) {
        throw new RewriteError(
          `level has ${entry.level.categories.length} categories; editor supports up to ${LETTERS.length}.`,
        );
      }
      counts = simpleTileCounts(entry.level);
    } catch (e) {
      return {
        name: entry.name,
        status: 'error',
        error: e instanceof RewriteError ? e.message : String(e),
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
    const baseNames = entry.level.categories.map((c) => c.categoryId);
    const slots: AssignSlot[] = counts.map((n, i) => ({ letter: LETTERS[i], simpleCards: n }));
    const previews = computeAssignments(
      slots,
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
  if (row.status !== 'ok') {
    throw new FillError(row.error ?? 'row not fixable');
  }
  const dup = row.previews.find((p) => p.duplicate);
  if (dup) {
    throw new FillError(`duplicate category "${dup.categoryId}"`);
  }
  // Rewrite only the non-image categories from their previewed assignment.
  // Image categories (and the board/stock cardIds pointing into them) are left
  // verbatim — fixing text gaps never disturbs imaged slots, so no splice-back.
  const rewrites = row.previews
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => !row.imageLetters.has(LETTERS[i]))
    .map(({ p, i }) => ({ index: i, categoryId: p.categoryId, words: p.chosen }));
  return rewriteCategories(row.level, rewrites);
}
