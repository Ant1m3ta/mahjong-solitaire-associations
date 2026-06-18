import type { LevelData } from '../types';
import type { SkeletonStockEntry } from './types';
import type { LevelFileEntry } from './save';
import { unfillLevel, UnfillError } from './unfill';
import { analyzeGreedySkeleton, type GreedyResult } from './solver/greedy';
import { applyOrderToLevel, applyOrderToSkeleton, planStockReorder } from './reorderFix';

// The modal classifies every level eagerly on open, so cap the per-level random
// search lower than the CLI default to keep it responsive. Fixable levels are
// still found fast (winning orders are plentiful); the CLI is the thorough path.
const MODAL_SEARCH_BUDGET = 1000;

export type ReorderStatusKind = 'error' | 'fair' | 'trap-fixed' | 'trap-unfixable';

// One level's reorder state: whether the straightforward player softlocks and,
// if so, whether a lossless stock reorder fixes it.
export interface ReorderRow {
  name: string;
  status: ReorderStatusKind;
  error?: string;
  reason?: string;
  before?: GreedyResult;
  // Stock as the editor shows it (array order, "first drawn →"), category cards
  // upper-case, simples lower-case. afterStock present only when trap-fixed.
  beforeStock: string[];
  afterStock?: string[];
  // Array-order permutation into the original stock; present when trap-fixed.
  order?: number[];
  // Carried so the apply step can permute the concrete cardIds losslessly.
  level?: LevelData;
}

function token(e: SkeletonStockEntry): string {
  return e.kind === 'category' ? e.letter : e.letter.toLowerCase();
}

export function buildReorderPlan(entries: LevelFileEntry[]): ReorderRow[] {
  return entries.map((entry) => {
    let skel;
    try {
      skel = unfillLevel(entry.level);
    } catch (e) {
      return {
        name: entry.name,
        status: 'error',
        error: e instanceof UnfillError ? e.message : String(e),
        beforeStock: [],
      };
    }

    const before = analyzeGreedySkeleton(skel);
    const beforeStock = skel.stock.map(token);
    const plan = planStockReorder(skel, MODAL_SEARCH_BUDGET);

    if (plan.status === 'already-fair') {
      return { name: entry.name, status: 'fair', before, beforeStock, level: entry.level };
    }
    if (plan.status === 'fixed' && plan.order) {
      const afterStock = applyOrderToSkeleton(skel, plan.order).stock.map(token);
      return {
        name: entry.name,
        status: 'trap-fixed',
        before,
        beforeStock,
        afterStock,
        order: plan.order,
        level: entry.level,
      };
    }
    return {
      name: entry.name,
      status: 'trap-unfixable',
      reason: plan.reason,
      before,
      beforeStock,
      level: entry.level,
    };
  });
}

// Apply the reorder to the concrete level losslessly (permutes existing stock
// cardIds — words / images / board untouched), then re-verify the straightforward
// player wins before handing it back to be written.
export function applyReorderRow(row: ReorderRow): LevelData {
  if (row.status !== 'trap-fixed' || !row.order || !row.level) {
    throw new Error(row.reason ?? 'level is not reorder-fixable');
  }
  const out = applyOrderToLevel(row.level, row.order);
  const verify = analyzeGreedySkeleton(unfillLevel(out));
  if (verify.outcome !== 'won') {
    throw new Error('reorder failed verification (straightforward play still softlocks)');
  }
  return out;
}
