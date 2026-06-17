import type { LevelData } from '../types';
import type { SkeletonLevel } from './types';
import type { LevelFileEntry } from './save';
import { unfillLevel, UnfillError } from './unfill';
import { fillSkeleton, FillError } from './fill';
import { computeAssignments, type SlotPreview } from './rangeAssign';
import { overridesForLevel } from './batchFill';

// One level's fix state: its existing categories resolved against the current
// catalog (so gaps reflect what's still missing right now), plus whether the
// file carries base-fill placeholder markers.
export interface FixRow {
  name: string;
  status: 'ok' | 'error';
  error?: string;
  skeleton?: SkeletonLevel;
  previews: SlotPreview[];
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
        previews: [],
        gapCount: 0,
        duplicateCount: 0,
        fileIncomplete: false,
      };
    }
    // Base each slot on the level's existing category; an override replaces it.
    const baseNames = skeleton.categories.map((c) => c.pinnedCategoryId);
    const previews = computeAssignments(
      skeleton.categories,
      0,
      overridesForLevel(overrides, entry.name),
      baseNames,
    );
    const fileIncomplete = entry.level.categories.some(
      (c) => c.incomplete || c.wordsData.some((w) => w.missing),
    );
    return {
      name: entry.name,
      status: 'ok',
      skeleton,
      previews,
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
  const dup = row.previews.find((p) => p.duplicate);
  if (dup) {
    throw new FillError(`duplicate category "${dup.categoryId}"`);
  }
  const byLetter = new Map(row.previews.map((p) => [p.letter, p]));
  const categories = row.skeleton.categories.map((c) => {
    const p = byLetter.get(c.letter);
    return p ? { ...c, pinnedCategoryId: p.categoryId, pinnedWords: p.chosen } : c;
  });
  return fillSkeleton({ ...row.skeleton, categories }, { padGaps: true });
}
