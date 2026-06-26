import type { Action, GameState, LevelData } from '../../types';
import { applyAction, isWon } from '../../game/moves';
import { enumerateMoves, type EnumerateOpts } from './enumerate';
import { hashState } from './hash';
import { solverStateFromLevel } from './levelState';
import { admissibleHeuristic, searchHeuristic } from './heuristic';
import { MinHeap } from './heap';

export type SolverStatus = 'solved' | 'unsolvable' | 'timeout' | 'invalid' | 'empty';

export interface SolverStats {
  statesExplored: number;
  elapsedMs: number;
  queuePeak: number;
}

export interface SolverResult {
  status: SolverStatus;
  message?: string;
  movesUsed?: number;
  optimalityProven: boolean;
  moveIndexByCellKey: [string, number][];
  stats: SolverStats;
}

export interface SolverOptions {
  maxStates: number;
  maxMs: number;
  enumerate?: EnumerateOpts;
  greedyWeight?: number;
  useAdmissibleHeuristic?: boolean;
  // Optional shared cache for solvability classification across multiple runs.
  // On a `solved` result, every state on the reconstructed path is marked true.
  // On an exhaustive `unsolvable`, every visited state is marked false.
  // `timeout` results never write.
  solvableCache?: Map<string, boolean>;
}

const DEFAULT_OPTIONS: SolverOptions = {
  maxStates: 1000000,
  maxMs: 17000,
  greedyWeight: 1,
  enumerate: { drawOnlyWhenHandEmpty: false },
};

export const DEFAULT_ENUMERATE_OPTS: EnumerateOpts = {
  drawOnlyWhenHandEmpty: false,
};

interface VisitedEntry {
  parent: string | null;
  action: Action | null;
  g: number;
}

// Run the solver from a live in-game state. movesLimit is stripped so the
// search isn't bounded by the player's remaining moves — the result reports
// how many moves the optimal path needs from here.
export function solveGameState(
  state: GameState,
  options: Partial<SolverOptions> = {},
): SolverResult {
  const opts: SolverOptions = { ...DEFAULT_OPTIONS, ...options };
  const startedAt = performance.now();
  const initial: GameState = { ...state, movesUsed: 0, movesLimit: -1 };
  return runSearch(initial, opts, startedAt);
}

// LevelData-native A* entry. Builds the solver state via the real game path and
// runs the same search. Used by the batch tools and CLIs.
export function solveLevel(
  level: LevelData,
  options: Partial<SolverOptions> = {},
): SolverResult {
  const startedAt = performance.now();
  if ((level.board?.length ?? 0) === 0 && (level.stock?.length ?? 0) === 0) {
    return {
      status: 'empty',
      optimalityProven: true,
      moveIndexByCellKey: [],
      stats: { statesExplored: 0, elapsedMs: 0, queuePeak: 0 },
    };
  }
  let initial: GameState;
  try {
    initial = solverStateFromLevel(level);
  } catch (err) {
    return {
      status: 'invalid',
      message: err instanceof Error ? err.message : String(err),
      optimalityProven: false,
      moveIndexByCellKey: [],
      stats: { statesExplored: 0, elapsedMs: performance.now() - startedAt, queuePeak: 0 },
    };
  }
  return solveGameState(initial, options);
}

function runSearch(
  initial: GameState,
  opts: SolverOptions,
  startedAt: number,
): SolverResult {

  if (isWon(initial)) {
    return {
      status: 'solved',
      movesUsed: 0,
      optimalityProven: true,
      moveIndexByCellKey: [],
      stats: { statesExplored: 0, elapsedMs: performance.now() - startedAt, queuePeak: 0 },
    };
  }

  const weight = opts.greedyWeight ?? 1;
  const heuristic = opts.useAdmissibleHeuristic ? admissibleHeuristic : searchHeuristic;
  const initHash = hashState(initial);
  const visited = new Map<string, VisitedEntry>();
  visited.set(initHash, { parent: null, action: null, g: 0 });

  const heap = new MinHeap<{ hash: string; state: GameState; g: number }>();
  heap.push(heuristic(initial), { hash: initHash, state: initial, g: 0 });

  let queuePeak = 1;
  let timeoutReason: string | null = null;
  let goalHash: string | null = null;
  let popCount = 0;

  while (heap.size() > 0) {
    if (visited.size >= opts.maxStates) {
      timeoutReason = `state cap (${opts.maxStates})`;
      break;
    }
    if ((popCount & 1023) === 0 && performance.now() - startedAt > opts.maxMs) {
      timeoutReason = `time cap (${opts.maxMs}ms)`;
      break;
    }
    const popped = heap.pop()!;
    popCount++;
    const { hash, state, g } = popped.value;
    const v = visited.get(hash);
    if (!v || v.g < g) continue;

    if (isWon(state)) {
      goalHash = hash;
      break;
    }

    const actions = enumerateMoves(state, opts.enumerate);
    for (const action of actions) {
      let nextState: GameState;
      try {
        nextState = applyAction(state, action);
      } catch {
        continue;
      }
      const nextHash = hashState(nextState);
      const newG = g + 1;
      const existing = visited.get(nextHash);
      if (existing && existing.g <= newG) continue;
      visited.set(nextHash, { parent: hash, action, g: newG });
      const f = newG + weight * heuristic(nextState);
      heap.push(f, { hash: nextHash, state: nextState, g: newG });
      if (heap.size() > queuePeak) queuePeak = heap.size();
    }
  }

  const elapsedMs = performance.now() - startedAt;

  if (goalHash !== null) {
    const path = reconstructPath(goalHash, visited);
    const moveIndexByCellKey = computeMoveIndices(initial, path);
    if (opts.solvableCache) {
      markPathAsSolvable(goalHash, visited, opts.solvableCache);
    }
    return {
      status: 'solved',
      movesUsed: path.length,
      optimalityProven: weight === 1 && opts.useAdmissibleHeuristic === true,
      moveIndexByCellKey: Array.from(moveIndexByCellKey.entries()),
      stats: { statesExplored: visited.size, elapsedMs, queuePeak },
    };
  }

  if (timeoutReason) {
    return {
      status: 'timeout',
      message: timeoutReason,
      optimalityProven: false,
      moveIndexByCellKey: [],
      stats: { statesExplored: visited.size, elapsedMs, queuePeak },
    };
  }

  if (opts.solvableCache) {
    for (const hash of visited.keys()) opts.solvableCache.set(hash, false);
  }
  return {
    status: 'unsolvable',
    optimalityProven: true,
    moveIndexByCellKey: [],
    stats: { statesExplored: visited.size, elapsedMs, queuePeak },
  };
}

function markPathAsSolvable(
  goalHash: string,
  visited: Map<string, VisitedEntry>,
  cache: Map<string, boolean>,
): void {
  let cur: string | null = goalHash;
  while (cur !== null) {
    cache.set(cur, true);
    const entry = visited.get(cur);
    if (!entry) break;
    cur = entry.parent;
  }
}

function reconstructPath(
  goalHash: string,
  visited: Map<string, VisitedEntry>,
): Action[] {
  const actions: Action[] = [];
  let cur: string | null = goalHash;
  while (cur !== null) {
    const entry = visited.get(cur);
    if (!entry || entry.action === null || entry.parent === null) break;
    actions.push(entry.action);
    cur = entry.parent;
  }
  actions.reverse();
  return actions;
}

function computeMoveIndices(
  initial: GameState,
  actions: Action[],
): Map<string, number> {
  const byUid = new Map<string, number>();
  const cellByUid = new Map<string, string>();
  const presence = new Set<string>();
  for (const slot of initial.boardSlots) {
    for (const e of slot.cards) {
      presence.add(e.card.uid);
      cellByUid.set(e.card.uid, `${slot.x},${slot.y},${e.z}`);
    }
  }

  let state = initial;
  for (let i = 0; i < actions.length; i++) {
    state = applyAction(state, actions[i]);
    const nextPresence = new Set<string>();
    for (const slot of state.boardSlots) {
      for (const e of slot.cards) nextPresence.add(e.card.uid);
    }
    for (const uid of presence) {
      if (!nextPresence.has(uid)) byUid.set(uid, i + 1);
    }
    presence.clear();
    for (const uid of nextPresence) presence.add(uid);
  }

  const result = new Map<string, number>();
  for (const [uid, moveIdx] of byUid.entries()) {
    const key = cellByUid.get(uid);
    if (key !== undefined) result.set(key, moveIdx);
  }
  return result;
}
