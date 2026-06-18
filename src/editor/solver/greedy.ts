import type { Action, GameState } from '../../types';
import { applyAction, isWon } from '../../game/moves';
import { getChainEntries, isSlotRevealed } from '../../game/coverage';
import { hashState } from './hash';
import { buildSolverInput, SolverInputError } from './buildState';
import type { SkeletonLevel } from '../types';

export type GreedyOutcome = 'won' | 'softlock' | 'invalid' | 'empty';

export interface GreedyResult {
  outcome: GreedyOutcome;
  message?: string;
  movesUsed: number;
  // null when the level's move limit is unlimited (< 0).
  withinMoveLimit: boolean | null;
  // Categories with unconsumed simples that have no slot to go into (softlock).
  starvedCategories: string[];
  // Locked categories occupying a slot they can no longer clear (softlock).
  deadLockedCategories: string[];
  // Earliest move on which a dead-locked category took its slot — the lock that
  // most plausibly caused the softlock. null if none / not a softlock.
  firstFatalLockStep: number | null;
}

// The "straightforward" no-lookahead player. First applicable rule wins; ties
// break on board-slot order then lowest category-slot index, so the policy is
// fully deterministic and reproducible.
//
//  1. Feed a simple into a matching locked slot (board first, then hand) — pure
//     progress, and clearing a category auto-frees its slot.
//  2. Lock an empty slot with the category we can make the MOST immediate
//     progress on — the one with the most reachable simples right now (a person
//     locks what they can actually start matching, board card or drawn card,
//     not a buried blocker). Only categories with a reachable simple qualify.
//  3. Nothing immediately feedable — lock on sight: a board category card to
//     uncover what's beneath it, else commit the drawn (hand) category card.
//     This is where genuine order traps bite.
//  4. Draw.
//  5. Stuck.
export function chooseGreedyAction(state: GameState): Action | null {
  const cats = state.categorySlots;

  // 1a — board chain containing a simple, into a matching locked slot.
  for (const slot of state.boardSlots) {
    if (!isSlotRevealed(slot, state.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0) continue;
    if (!chain.some((e) => !e.card.isCategory)) continue; // no simple → no progress
    const cat = chain[chain.length - 1].card.category;
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].lockedCategory === cat) {
        return { type: 'BOARD_TO_CATEGORY', from: { x: slot.x, y: slot.y }, slotIndex: i };
      }
    }
  }

  // 1b — hand simple into a matching locked slot.
  if (state.hand && !state.hand.isCategory) {
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].lockedCategory === state.hand.category) {
        return { type: 'HAND_TO_CATEGORY', slotIndex: i };
      }
    }
  }

  const emptyIdx = cats.findIndex((s) => s.lockedCategory === null);
  if (emptyIdx < 0) {
    // 4 — no slot to lock into; draw (recycles the hand when stock is empty).
    return state.stock.length > 0 || state.hand !== null ? { type: 'DRAW' } : null;
  }

  const locked = new Set<string>();
  for (const s of cats) if (s.lockedCategory) locked.add(s.lockedCategory);
  const reach = reachableSimpleCountByCat(state);

  // 2 — lock the most-feedable new category (board card or drawn card). Highest
  // reachable-simple score wins; ties keep board order (then hand) for stability.
  const candidates: { action: Action; score: number }[] = [];
  for (const slot of state.boardSlots) {
    if (!isSlotRevealed(slot, state.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0) continue;
    const canLock =
      chain.length === 1 ? chain[0].card.isCategory : chain.some((e) => e.card.isCategory);
    if (!canLock) continue;
    const cat = chain[chain.length - 1].card.category;
    if (locked.has(cat)) continue;
    const score = reach.get(cat) ?? 0;
    if (score > 0) {
      candidates.push({
        action: { type: 'BOARD_TO_CATEGORY', from: { x: slot.x, y: slot.y }, slotIndex: emptyIdx },
        score,
      });
    }
  }
  if (state.hand && state.hand.isCategory && !locked.has(state.hand.category)) {
    const score = reach.get(state.hand.category) ?? 0;
    if (score > 0) candidates.push({ action: { type: 'HAND_TO_CATEGORY', slotIndex: emptyIdx }, score });
  }
  if (candidates.length > 0) {
    let bestI = 0;
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].score > candidates[bestI].score) bestI = i;
    }
    return candidates[bestI].action;
  }

  // 3 — nothing feedable: lock on sight (board to uncover, else commit the draw).
  for (const slot of state.boardSlots) {
    if (!isSlotRevealed(slot, state.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0) continue;
    const canLock =
      chain.length === 1 ? chain[0].card.isCategory : chain.some((e) => e.card.isCategory);
    if (canLock) {
      return { type: 'BOARD_TO_CATEGORY', from: { x: slot.x, y: slot.y }, slotIndex: emptyIdx };
    }
  }
  if (state.hand && state.hand.isCategory) {
    return { type: 'HAND_TO_CATEGORY', slotIndex: emptyIdx };
  }

  // 4 — draw (recycles the hand when the stock is exhausted).
  if (state.stock.length > 0 || state.hand !== null) {
    return { type: 'DRAW' };
  }
  return null;
}

// Reachable, immediately-consumable simples per category: revealed board slots
// whose chain holds a simple, keyed by the chain's category.
function reachableSimpleCountByCat(state: GameState): Map<string, number> {
  const m = new Map<string, number>();
  for (const slot of state.boardSlots) {
    if (!isSlotRevealed(slot, state.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0 || !chain.some((e) => !e.card.isCategory)) continue;
    const cat = chain[chain.length - 1].card.category;
    m.set(cat, (m.get(cat) ?? 0) + 1);
  }
  return m;
}

// Hard backstop. Non-draw moves are strictly productive (each consumes a simple
// or locks a slot), so they are bounded by card count; draws between them are
// bounded by one deck cycle (caught by hash revisit). This only guards against a
// logic bug.
const MAX_MOVES = 100_000;

export function simulateGreedy(
  initialState: GameState,
  reportLimit: number = initialState.movesLimit,
): GreedyResult {
  let state: GameState = { ...initialState, movesUsed: 0, movesLimit: -1 };
  if (isWon(state)) return won(state, reportLimit);

  const lockStep = new Map<string, number>();
  recordLocks(state, lockStep, 0);

  // Cycle detection only needs to span draw runs: a full deck cycle with no
  // productive move revisits an identical hash. Any productive move opens a new
  // regime, so the seen-set resets.
  let seen = new Set<string>([hashState(state)]);

  while (state.movesUsed < MAX_MOVES) {
    const action = chooseGreedyAction(state);
    if (action === null) return softlock(state, reportLimit, lockStep);

    let next: GameState;
    try {
      next = applyAction(state, action);
    } catch {
      return softlock(state, reportLimit, lockStep);
    }

    if (action.type === 'DRAW') {
      const h = hashState(next);
      if (seen.has(h)) return softlock(next, reportLimit, lockStep);
      seen.add(h);
    } else {
      seen = new Set<string>([hashState(next)]);
      recordLocks(next, lockStep, next.movesUsed);
    }

    state = next;
    if (isWon(state)) return won(state, reportLimit);
  }
  return softlock(state, reportLimit, lockStep);
}

export function analyzeGreedySkeleton(skel: SkeletonLevel): GreedyResult {
  if (skel.board.length === 0 && skel.stock.length === 0) {
    return blank('empty');
  }
  let initial: GameState;
  try {
    initial = buildSolverInput(skel).initialState;
  } catch (err) {
    return {
      ...blank('invalid'),
      message: err instanceof SolverInputError ? err.message : String(err),
    };
  }
  return simulateGreedy(initial, skel.movesLimit);
}

function recordLocks(state: GameState, map: Map<string, number>, step: number): void {
  for (const s of state.categorySlots) {
    if (s.lockedCategory !== null && !map.has(s.lockedCategory)) {
      map.set(s.lockedCategory, step);
    }
  }
}

function remainingByCategory(state: GameState): Map<string, number> {
  const rem = new Map<string, number>();
  for (const c of state.level.categories) rem.set(c.categoryId, c.wordsData.length);
  for (const c of state.consumedSimple) rem.set(c.category, (rem.get(c.category) ?? 0) - 1);
  return rem;
}

function withinLimit(movesUsed: number, reportLimit: number): boolean | null {
  return reportLimit < 0 ? null : movesUsed <= reportLimit;
}

function won(state: GameState, reportLimit: number): GreedyResult {
  return {
    outcome: 'won',
    movesUsed: state.movesUsed,
    withinMoveLimit: withinLimit(state.movesUsed, reportLimit),
    starvedCategories: [],
    deadLockedCategories: [],
    firstFatalLockStep: null,
  };
}

function softlock(
  state: GameState,
  reportLimit: number,
  lockStep: Map<string, number>,
): GreedyResult {
  const rem = remainingByCategory(state);
  const locked = new Set<string>();
  for (const s of state.categorySlots) if (s.lockedCategory) locked.add(s.lockedCategory);

  const starved: string[] = [];
  const dead: string[] = [];
  for (const [cat, n] of rem) {
    if (n <= 0) continue;
    (locked.has(cat) ? dead : starved).push(cat);
  }

  let firstFatal: number | null = null;
  for (const cat of dead) {
    const s = lockStep.get(cat);
    if (s !== undefined && (firstFatal === null || s < firstFatal)) firstFatal = s;
  }

  return {
    outcome: 'softlock',
    movesUsed: state.movesUsed,
    withinMoveLimit: withinLimit(state.movesUsed, reportLimit),
    starvedCategories: starved.sort(),
    deadLockedCategories: dead.sort(),
    firstFatalLockStep: firstFatal,
  };
}

function blank(outcome: GreedyOutcome): GreedyResult {
  return {
    outcome,
    movesUsed: 0,
    withinMoveLimit: null,
    starvedCategories: [],
    deadLockedCategories: [],
    firstFatalLockStep: null,
  };
}
