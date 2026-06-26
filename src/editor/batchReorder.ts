import type { LevelData } from '../types';
import type { LevelFileEntry } from './save';
import { analyzeGreedyLevel, type GreedyResult } from './solver/greedy';
import { applyOrderToLevel, planStockReorderLevel } from './reorderFix';
import { buildResolver, displayLetter } from './editorLevel';

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

// Stock cardIds as the editor's short tokens: each card's display letter, upper
// for the category (lock) card, lower for a simple.
function stockTokens(level: LevelData): string[] {
  const resolve = buildResolver(level);
  return level.stock.map((cardId) => {
    const r = resolve(cardId);
    const letter = displayLetter(r.index);
    return r.kind === 'category' ? letter : letter.toLowerCase();
  });
}

export function buildReorderPlan(entries: LevelFileEntry[]): ReorderRow[] {
  return entries.map((entry) => {
    const before = analyzeGreedyLevel(entry.level);
    if (before.outcome === 'invalid') {
      return { name: entry.name, status: 'error', error: before.message ?? 'invalid level', beforeStock: [] };
    }
    const beforeStock = stockTokens(entry.level);
    const plan = planStockReorderLevel(entry.level, MODAL_SEARCH_BUDGET);

    if (plan.status === 'already-fair') {
      return { name: entry.name, status: 'fair', before, beforeStock, level: entry.level };
    }
    if (plan.status === 'fixed' && plan.order) {
      const afterStock = stockTokens(applyOrderToLevel(entry.level, plan.order));
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
  const verify = analyzeGreedyLevel(out);
  if (verify.outcome !== 'won') {
    throw new Error('reorder failed verification (straightforward play still softlocks)');
  }
  return out;
}
