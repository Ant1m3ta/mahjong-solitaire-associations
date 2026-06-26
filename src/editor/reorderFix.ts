import type { Card, GameState, LevelData } from '../types';
import { applyAction, isWon } from '../game/moves';
import { getChainEntries, isSlotRevealed } from '../game/coverage';
import { solverStateFromLevel } from './solver/levelState';
import { analyzeGreedyLevel, chooseGreedyAction, type GreedyResult } from './solver/greedy';

export type ReorderStatus = 'already-fair' | 'fixed' | 'unfixable';

export interface ReorderPlan {
  status: ReorderStatus;
  reason?: string;
  // Array-order indices into the ORIGINAL stock, present only when 'fixed'.
  // skel.stock[i] aligns 1:1 with level.stock[i] (unfill maps them index-for-
  // index), so the same permutation applies losslessly to either.
  order?: number[];
}

// Apply a reorder permutation to a concrete LevelData's stock cardIds. Lossless —
// just a permutation of the existing ids; board / words / images untouched.
export function applyOrderToLevel(level: LevelData, order: number[]): LevelData {
  return { ...level, stock: order.map((i) => level.stock[i]) };
}

// Random stock orders to try before declaring a level unfixable. Each trial is
// one greedy simulation; fixable levels almost always hit within a handful of
// trials (winning orders are usually plentiful), so the full budget is only
// spent on genuinely board-driven traps. The interactive batch modal passes a
// smaller budget to stay responsive; the CLI uses the default.
export const REORDER_SEARCH_BUDGET = 4000;

export function planStockReorderLevel(
  level: LevelData,
  searchBudget: number = REORDER_SEARCH_BUDGET,
): ReorderPlan {
  const before = analyzeGreedyLevel(level);
  const guard = guardReorder(before);
  if (guard) return guard;

  let initial: GameState;
  try {
    initial = solverStateFromLevel(level);
  } catch (err) {
    return {
      status: 'unfixable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const verify = (order: number[]): boolean =>
    analyzeGreedyLevel(applyOrderToLevel(level, order)).outcome === 'won';

  return planReorderCore(before, initial, level.stock.length, verify, searchBudget);
}

// A level the straightforward player already wins (or that's empty) needs no
// reorder; an invalid one can't be reordered into a fix.
function guardReorder(before: GreedyResult): ReorderPlan | null {
  if (before.outcome === 'won') return { status: 'already-fair' };
  if (before.outcome === 'empty') return { status: 'already-fair' };
  if (before.outcome === 'invalid') {
    return { status: 'unfixable', reason: before.message ?? 'invalid level' };
  }
  return null;
}

function planReorderCore(
  before: GreedyResult,
  initial: GameState,
  stockLen: number,
  verify: (order: number[]) => boolean,
  searchBudget: number,
): ReorderPlan {
  // 1) Constructive greedy-safe scheduler — fast, and yields the smallest diff
  //    when it works. Accept the first order the straightforward player wins (a
  //    greedy win itself proves solvability, so no A* re-check is needed).
  for (const pref of ['progress', 'close'] as const) {
    const order = buildSchedule(initial, pref);
    if (order && verify(order)) return { status: 'fixed', order };
  }

  // 2) Randomized verified search over stock orderings. The constructive
  //    scheduler can corner itself even when many winning orders exist (e.g.
  //    every category card is in the stock and slots are tight), so fall back to
  //    verified shuffles. Seeded, so a given level always resolves the same way.
  const indices = Array.from({ length: stockLen }, (_, i) => i);
  const rng = mulberry32((0x9e3779b9 ^ Math.imul(stockLen, 2654435761)) >>> 0);
  for (let t = 0; t < searchBudget; t++) {
    const order = shuffleWith(indices.slice(), rng);
    if (verify(order)) return { status: 'fixed', order };
  }

  return { status: 'unfixable', reason: unfixableReason(before) };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith(arr: number[], rng: () => number): number[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type OpenPref = 'progress' | 'close';

interface BagItem {
  card: Card;
  idx: number; // original index in skel.stock / level.stock
}

// Constructive greedy-safe scheduler. Replays the straightforward policy but
// chooses which stock card to "draw" next so the player never strands itself:
// feed locked categories first, open a new category only into a free slot and
// only when it can actually progress. Returns array-order indices (first-drawn
// last, matching applyDraw popping from the end) or null if it stalls.
function buildSchedule(initial: GameState, pref: OpenPref): number[] | null {
  let state: GameState = { ...initial, stock: [], hand: null, movesUsed: 0, movesLimit: -1 };
  const bag: BagItem[] = initial.stock.map((card, idx) => ({ card, idx }));
  const drawn: number[] = [];

  const exhaust = () => {
    while (true) {
      const a = chooseGreedyAction(state);
      if (a === null || a.type === 'DRAW') break;
      state = applyAction(state, a);
    }
  };

  exhaust();
  let guard = bag.length + 5;
  while (!isWon(state)) {
    if (--guard < 0 || bag.length === 0) return null;
    const pick = chooseBagCard(state, bag, pref);
    if (pick < 0) return null;
    const item = bag.splice(pick, 1)[0];
    state = { ...state, hand: item.card };
    drawn.push(item.idx);
    exhaust();
    // The pick should have been placed; if it lingers in hand it was unplaceable.
    if (state.hand && state.hand.uid === item.card.uid) return null;
  }

  const leftover = bag.map((b) => b.idx).sort((a, b) => a - b);
  return [...drawn, ...leftover].reverse();
}

function chooseBagCard(state: GameState, bag: BagItem[], pref: OpenPref): number {
  const locked = new Set<string>();
  for (const s of state.categorySlots) if (s.lockedCategory) locked.add(s.lockedCategory);

  // 1 — feed a locked category from the bag (pure progress, hastens auto-clear).
  let bestSimple = -1;
  for (let i = 0; i < bag.length; i++) {
    const c = bag[i].card;
    if (!c.isCategory && locked.has(c.category)) {
      if (bestSimple < 0 || bag[i].idx < bag[bestSimple].idx) bestSimple = i;
    }
  }
  if (bestSimple >= 0) return bestSimple;

  if (!state.categorySlots.some((s) => s.lockedCategory === null)) return -1;

  // 2 — open a new category. Only those with simples still to consume; prefer a
  // category we can feed right away (board-reachable now, or sitting in the bag)
  // so the freshly taken slot makes progress instead of dead-locking.
  const rem = remainingByCategory(state);
  const reachable = reachableBoardSimpleCategories(state);
  const inBag = new Set<string>();
  for (const b of bag) if (!b.card.isCategory) inBag.add(b.card.category);

  const openable: number[] = [];
  for (let i = 0; i < bag.length; i++) {
    const c = bag[i].card;
    if (!c.isCategory || locked.has(c.category)) continue;
    if ((rem.get(c.category) ?? 0) <= 0) continue;
    openable.push(i);
  }
  if (openable.length === 0) return -1;

  const feedable = openable.filter((i) => {
    const cat = bag[i].card.category;
    return reachable.has(cat) || inBag.has(cat);
  });
  const pool = feedable.length > 0 ? feedable : openable;

  pool.sort((a, b) => {
    if (pref === 'close') {
      const d = (rem.get(bag[a].card.category) ?? 0) - (rem.get(bag[b].card.category) ?? 0);
      if (d !== 0) return d;
    }
    return bag[a].idx - bag[b].idx;
  });
  return pool[0];
}

function remainingByCategory(state: GameState): Map<string, number> {
  const rem = new Map<string, number>();
  for (const c of state.level.categories) rem.set(c.categoryId, c.wordsData.length);
  for (const c of state.consumedSimple) rem.set(c.category, (rem.get(c.category) ?? 0) - 1);
  return rem;
}

function reachableBoardSimpleCategories(state: GameState): Set<string> {
  const cats = new Set<string>();
  for (const slot of state.boardSlots) {
    if (!isSlotRevealed(slot, state.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.some((e) => !e.card.isCategory)) cats.add(chain[chain.length - 1].card.category);
  }
  return cats;
}

function unfixableReason(before: { deadLockedCategories: string[]; starvedCategories: string[] }): string {
  const dead = before.deadLockedCategories;
  const starved = before.starvedCategories;
  const bits: string[] = [];
  if (dead.length) bits.push(`${dead.join(', ')} dead-lock a slot`);
  if (starved.length) bits.push(`${starved.join(', ')} starve`);
  const detail = bits.length ? ` (${bits.join('; ')})` : '';
  return `Reordering the stock can't avoid the softlock${detail} — a blocking category is locked from the board or its simples are buried. Needs a board / slot-count change.`;
}
