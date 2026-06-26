import type { Action, Card, GameState, LevelData } from '../../types';
import { applyAction, isWon } from '../../game/moves';
import { getChainEntries, isSlotRevealed } from '../../game/coverage';
import { hashState } from './hash';
import { buildSolverInput, SolverInputError } from './buildState';
import { solverStateFromLevel } from './levelState';
import type { SkeletonLevel } from '../types';

// Straightforward (no-lookahead) player, faithful to the Unity SoliJong
// MoveEngine — where the hand is an accumulating WASTE pile, not a single card:
//   * a draw pushes the stock's top onto the waste (only the waste TOP is
//     playable); you can play several cards down the pile without drawing.
//   * drawing when the stock is empty recycles the reversed waste back into the
//     stock — itself a move that exposes no card.
// Board / chain / coverage / category lock-consume-autoclear are identical to the
// single-card model, so applyAction is reused for board moves and (via a
// transient hand) for playing the waste top; only draw/recycle is modelled here.
// This makes the move COUNT and softlock detection match the shipping game, which
// the single-card greedy in greedy.ts does not.

export type WasteOutcome = 'won' | 'softlock' | 'invalid' | 'empty';

export interface WasteGreedyResult {
  outcome: WasteOutcome;
  message?: string;
  movesUsed: number; // competent-player move cost when 'won'
  starvedCategories: string[];
  deadLockedCategories: string[];
}

interface WasteState {
  gs: GameState; // hand stays null between steps; the waste is held separately
  waste: Card[]; // top of pile = last element
}

type Step =
  | { kind: 'board'; action: Action } // BOARD_TO_CATEGORY, applied via applyAction
  | { kind: 'waste'; slotIndex: number } // play the waste top into a slot
  | { kind: 'draw' }
  | null;

const MAX_MOVES = 100_000;

const wasteTop = (s: WasteState): Card | null =>
  s.waste.length > 0 ? s.waste[s.waste.length - 1] : null;

function wasteHash(s: WasteState): string {
  const w = s.waste.map((c) => `${c.category}${c.isCategory ? 'C' : 's'}`).join(',');
  return `${hashState(s.gs)}|W:${w}`;
}

// First applicable rule wins (mirrors greedy.ts, with the waste TOP standing in
// for the single hand card): 1 feed a simple into a matching locked slot; 2 lock
// the most-feedable new category via a category card; 3 lock a category card on
// sight; 4 draw; 5 stuck.
function choose(s: WasteState): Step {
  const { gs } = s;
  const cats = gs.categorySlots;

  // 1a — board chain holding a simple, into a matching locked slot.
  for (const slot of gs.boardSlots) {
    if (!isSlotRevealed(slot, gs.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0 || !chain.some((e) => !e.card.isCategory)) continue;
    const cat = chain[chain.length - 1].card.category;
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].lockedCategory === cat) {
        return { kind: 'board', action: { type: 'BOARD_TO_CATEGORY', from: { x: slot.x, y: slot.y }, slotIndex: i } };
      }
    }
  }

  // 1b — waste top is a simple matching a locked slot.
  const top = wasteTop(s);
  if (top && !top.isCategory) {
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].lockedCategory === top.category) return { kind: 'waste', slotIndex: i };
    }
  }

  const emptyIdx = cats.findIndex((c) => c.lockedCategory === null);
  if (emptyIdx < 0) {
    return gs.stock.length > 0 || s.waste.length > 0 ? { kind: 'draw' } : null;
  }

  const locked = new Set<string>();
  for (const c of cats) if (c.lockedCategory) locked.add(c.lockedCategory);
  const reach = reachableSimpleCountByCat(gs);

  // 2 — lock the most-feedable new category (board card or waste top).
  const candidates: { step: Step; score: number }[] = [];
  for (const slot of gs.boardSlots) {
    if (!isSlotRevealed(slot, gs.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0) continue;
    const canLock = chain.length === 1 ? chain[0].card.isCategory : chain.some((e) => e.card.isCategory);
    if (!canLock) continue;
    const cat = chain[chain.length - 1].card.category;
    if (locked.has(cat)) continue;
    const score = reach.get(cat) ?? 0;
    if (score > 0) {
      candidates.push({
        step: { kind: 'board', action: { type: 'BOARD_TO_CATEGORY', from: { x: slot.x, y: slot.y }, slotIndex: emptyIdx } },
        score,
      });
    }
  }
  if (top && top.isCategory && !locked.has(top.category)) {
    const score = reach.get(top.category) ?? 0;
    if (score > 0) candidates.push({ step: { kind: 'waste', slotIndex: emptyIdx }, score });
  }
  if (candidates.length > 0) {
    let best = 0;
    for (let i = 1; i < candidates.length; i++) if (candidates[i].score > candidates[best].score) best = i;
    return candidates[best].step;
  }

  // 3 — nothing feedable: lock a category card on sight (board to uncover, else waste top).
  for (const slot of gs.boardSlots) {
    if (!isSlotRevealed(slot, gs.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0) continue;
    const canLock = chain.length === 1 ? chain[0].card.isCategory : chain.some((e) => e.card.isCategory);
    if (canLock) {
      return { kind: 'board', action: { type: 'BOARD_TO_CATEGORY', from: { x: slot.x, y: slot.y }, slotIndex: emptyIdx } };
    }
  }
  if (top && top.isCategory) return { kind: 'waste', slotIndex: emptyIdx };

  // 4 — draw (accumulate onto the waste, or recycle when the stock is empty).
  if (gs.stock.length > 0 || s.waste.length > 0) return { kind: 'draw' };
  return null;
}

function reachableSimpleCountByCat(gs: GameState): Map<string, number> {
  const m = new Map<string, number>();
  for (const slot of gs.boardSlots) {
    if (!isSlotRevealed(slot, gs.boardSlots)) continue;
    const chain = getChainEntries(slot);
    if (chain.length === 0 || !chain.some((e) => !e.card.isCategory)) continue;
    const cat = chain[chain.length - 1].card.category;
    m.set(cat, (m.get(cat) ?? 0) + 1);
  }
  return m;
}

// Draw / recycle, faithful to ApplyDraw in the Unity MoveEngine.
function applyDraw(s: WasteState): WasteState {
  const gs = s.gs;
  if (gs.stock.length > 0) {
    const drawn = gs.stock[gs.stock.length - 1];
    return {
      gs: { ...gs, stock: gs.stock.slice(0, -1), movesUsed: gs.movesUsed + 1 },
      waste: [...s.waste, drawn],
    };
  }
  // Stock empty: recycle the reversed waste back into the stock (a move, no card drawn).
  return {
    gs: { ...gs, stock: [...s.waste].reverse(), movesUsed: gs.movesUsed + 1 },
    waste: [],
  };
}

function applyStep(s: WasteState, step: Exclude<Step, null | { kind: 'draw' }>): WasteState {
  if (step.kind === 'board') {
    return { gs: applyAction(s.gs, step.action), waste: s.waste };
  }
  // Play the waste top: hand it to applyAction transiently, then pop it.
  const top = s.waste[s.waste.length - 1];
  const gs = applyAction({ ...s.gs, hand: top }, { type: 'HAND_TO_CATEGORY', slotIndex: step.slotIndex });
  return { gs: { ...gs, hand: null }, waste: s.waste.slice(0, -1) };
}

function simulate(initial: GameState): WasteGreedyResult {
  let s: WasteState = { gs: { ...initial, hand: null, movesUsed: 0, movesLimit: -1 }, waste: [] };
  if (isWon(s.gs)) return won(s);

  // Cycle detection spans draw runs only; any productive move resets the set.
  let seen = new Set<string>([wasteHash(s)]);

  while (s.gs.movesUsed < MAX_MOVES) {
    const step = choose(s);
    if (step === null) return softlock(s);

    if (step.kind === 'draw') {
      s = applyDraw(s);
      const h = wasteHash(s);
      if (seen.has(h)) return softlock(s);
      seen.add(h);
    } else {
      try {
        s = applyStep(s, step);
      } catch {
        return softlock(s);
      }
      seen = new Set<string>([wasteHash(s)]);
    }

    if (isWon(s.gs)) return won(s);
  }
  return softlock(s);
}

export function analyzeWasteGreedySkeleton(skel: SkeletonLevel): WasteGreedyResult {
  if (skel.board.length === 0 && skel.stock.length === 0) return blank('empty');
  let initial: GameState;
  try {
    initial = buildSolverInput(skel).initialState;
  } catch (err) {
    return { ...blank('invalid'), message: err instanceof SolverInputError ? err.message : String(err) };
  }
  return simulate(initial);
}

// LevelData-native counterpart (real game path). Used by the batch tools/CLIs.
export function analyzeWasteGreedyLevel(level: LevelData): WasteGreedyResult {
  if (level.board.length === 0 && level.stock.length === 0) return blank('empty');
  let initial: GameState;
  try {
    initial = solverStateFromLevel(level);
  } catch (err) {
    return { ...blank('invalid'), message: err instanceof Error ? err.message : String(err) };
  }
  return simulate(initial);
}

function remainingByCategory(gs: GameState): Map<string, number> {
  const rem = new Map<string, number>();
  for (const c of gs.level.categories) rem.set(c.categoryId, c.wordsData.length);
  for (const c of gs.consumedSimple) rem.set(c.category, (rem.get(c.category) ?? 0) - 1);
  return rem;
}

function won(s: WasteState): WasteGreedyResult {
  return { outcome: 'won', movesUsed: s.gs.movesUsed, starvedCategories: [], deadLockedCategories: [] };
}

function softlock(s: WasteState): WasteGreedyResult {
  const rem = remainingByCategory(s.gs);
  const locked = new Set<string>();
  for (const c of s.gs.categorySlots) if (c.lockedCategory) locked.add(c.lockedCategory);
  const starved: string[] = [];
  const dead: string[] = [];
  for (const [cat, n] of rem) {
    if (n <= 0) continue;
    (locked.has(cat) ? dead : starved).push(cat);
  }
  return {
    outcome: 'softlock',
    movesUsed: s.gs.movesUsed,
    starvedCategories: starved.sort(),
    deadLockedCategories: dead.sort(),
  };
}

function blank(outcome: WasteOutcome): WasteGreedyResult {
  return { outcome, movesUsed: 0, starvedCategories: [], deadLockedCategories: [] };
}
