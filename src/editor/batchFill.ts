import type { LevelData } from '../types';
import type { SkeletonLevel } from './types';
import type { LevelFileEntry } from './save';
import { unfillLevel, UnfillError } from './unfill';
import { fillSkeleton, FillError } from './fill';
import { buildGenRequests, computeAssignments, type SlotPreview } from './rangeAssign';
import type { GenRequest } from './wordGen';

export interface BatchRow {
  name: string;
  selected: boolean;
  status: 'ok' | 'error';
  error?: string;
  skeleton?: SkeletonLevel;
  startIndex: number; // -1 when not processed (unselected / error)
  categoryCount: number;
  previews: SlotPreview[];
  gapCount: number; // total missing words across the level
  duplicateCount: number; // categories repeated within the level's window
}

// Walk the selected level files in order, giving each a contiguous slice of the
// category list. The cursor only advances for successfully-unfilled, selected
// rows, so unchecking a file (or a malformed one) doesn't burn indexes.
export function buildPlan(entries: LevelFileEntry[], selected: Set<string>): BatchRow[] {
  let cursor = 0;
  return entries.map((entry) => {
    const isSelected = selected.has(entry.name);
    if (!isSelected) {
      return emptyRow(entry.name, false, 'ok');
    }
    let skeleton: SkeletonLevel;
    try {
      skeleton = unfillLevel(entry.level);
    } catch (e) {
      const error = e instanceof UnfillError ? e.message : String(e);
      return { ...emptyRow(entry.name, true, 'error'), error };
    }
    const startIndex = cursor;
    const previews = computeAssignments(skeleton.categories, startIndex);
    cursor += skeleton.categories.length;
    return {
      name: entry.name,
      selected: true,
      status: 'ok',
      skeleton,
      startIndex,
      categoryCount: skeleton.categories.length,
      previews,
      gapCount: previews.reduce((n, p) => n + p.shortfall, 0),
      duplicateCount: previews.filter((p) => p.duplicate).length,
    };
  });
}

function emptyRow(name: string, selected: boolean, status: 'ok' | 'error'): BatchRow {
  return {
    name,
    selected,
    status,
    startIndex: -1,
    categoryCount: 0,
    previews: [],
    gapCount: 0,
    duplicateCount: 0,
  };
}

// Dedup'd word-generation requests across every selected level, taking the
// largest count requested for a repeated category name.
export function collectGenRequests(plan: BatchRow[]): GenRequest[] {
  const byName = new Map<string, GenRequest>();
  for (const row of plan) {
    if (row.status !== 'ok') continue;
    for (const req of buildGenRequests(row.previews, 2)) {
      const prev = byName.get(req.categoryId);
      if (prev) {
        prev.count = Math.max(prev.count, req.count);
        prev.avoid = Array.from(new Set([...(prev.avoid ?? []), ...(req.avoid ?? [])]));
      } else {
        byName.set(req.categoryId, { ...req });
      }
    }
  }
  return Array.from(byName.values());
}

// Lock a row's previewed categories + words into its skeleton and produce the
// final level JSON. Throws if any word is still missing (caller skips & reports).
export function fillRow(row: BatchRow): LevelData {
  if (row.status !== 'ok' || !row.skeleton) {
    throw new FillError(row.error ?? 'row not fillable');
  }
  if (row.gapCount > 0) {
    throw new FillError(`${row.gapCount} word${row.gapCount === 1 ? '' : 's'} still missing`);
  }
  const dup = row.previews.find((p) => p.duplicate);
  if (dup) {
    throw new FillError(`duplicate category "${dup.categoryId}" in range`);
  }
  const byLetter = new Map(row.previews.map((p) => [p.letter, p]));
  const categories = row.skeleton.categories.map((c) => {
    const p = byLetter.get(c.letter);
    return p ? { ...c, pinnedCategoryId: p.categoryId, pinnedWords: p.chosen } : c;
  });
  return fillSkeleton({ ...row.skeleton, categories });
}
