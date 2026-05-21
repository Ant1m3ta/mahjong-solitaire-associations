import type { GameState } from '../../types';

interface Counts {
  totalRemaining: number;
  unfinished: number;
  largest: number;
}

function tallySimples(state: GameState): Counts {
  const remaining = new Map<string, number>();
  for (const cat of state.level.categories) {
    remaining.set(cat.categoryId, cat.wordsData.length);
  }
  for (const c of state.consumedSimple) {
    remaining.set(c.category, (remaining.get(c.category) ?? 0) - 1);
  }
  let totalRemaining = 0;
  let unfinished = 0;
  let largest = 0;
  for (const r of remaining.values()) {
    if (r > 0) {
      totalRemaining += r;
      unfinished++;
      if (r > largest) largest = r;
    }
  }
  return { totalRemaining, unfinished, largest };
}

// Strict lower bound on remaining moves to win. Used to prune branches and
// detect provable unsolvability.
export function admissibleHeuristic(state: GameState): number {
  const { totalRemaining, unfinished, largest } = tallySimples(state);
  if (totalRemaining === 0) return 0;
  return Math.max(unfinished, Math.ceil(totalRemaining / largest));
}

// Inadmissible search heuristic biased toward clearing the board early.
// Each board card costs 1 move to remove; double-weighted so that paths which
// drop board cards are preferred over draw-and-stash plays. Each stock card
// needs at least 1 DRAW + 1 placement (= 2 moves). Hand adds 1 placement move.
export function searchHeuristic(state: GameState): number {
  let boardCards = 0;
  for (const slot of state.boardSlots) boardCards += slot.cards.length;
  const stockCards = state.stock.length;
  const handCost = state.hand ? 1 : 0;
  return 2 * boardCards + 2 * stockCards + handCost;
}
