import type { Action, GameState } from '../../types';
import { applyAction, isWon } from '../../game/moves';
import { enumerateMoves, type EnumerateOpts } from './enumerate';
import { hashState } from './hash';
import { buildSolverInput, SolverInputError, type SolverInput } from './buildState';
import type { SkeletonLevel } from '../types';
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
}

const DEFAULT_OPTIONS: SolverOptions = {
  maxStates: 1000000,
  maxMs: 17000,
  greedyWeight: 1,
  enumerate: { disableBoardToBoard: true, drawOnlyWhenHandEmpty: true },
};

interface VisitedEntry {
  parent: string | null;
  action: Action | null;
  g: number;
}

export function solveSkeleton(
  skel: SkeletonLevel,
  options: Partial<SolverOptions> = {},
): SolverResult {
  const opts: SolverOptions = { ...DEFAULT_OPTIONS, ...options };
  const startedAt = performance.now();

  if (skel.board.length === 0 && skel.stock.length === 0) {
    return {
      status: 'empty',
      optimalityProven: true,
      moveIndexByCellKey: [],
      stats: { statesExplored: 0, elapsedMs: 0, queuePeak: 0 },
    };
  }

  let input: SolverInput;
  try {
    input = buildSolverInput(skel);
  } catch (err) {
    return {
      status: 'invalid',
      message: err instanceof SolverInputError ? err.message : String(err),
      optimalityProven: false,
      moveIndexByCellKey: [],
      stats: { statesExplored: 0, elapsedMs: performance.now() - startedAt, queuePeak: 0 },
    };
  }

  return runSearch(input, opts, startedAt);
}

function runSearch(
  input: SolverInput,
  opts: SolverOptions,
  startedAt: number,
): SolverResult {
  const initial = input.initialState;

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

  return {
    status: 'unsolvable',
    optimalityProven: true,
    moveIndexByCellKey: [],
    stats: { statesExplored: visited.size, elapsedMs, queuePeak },
  };
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
