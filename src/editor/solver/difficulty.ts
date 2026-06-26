import type { Action, GameState } from '../../types';
import { applyAction, isWon } from '../../game/moves';
import { getChainEntries } from '../../game/coverage';
import { enumerateMoves } from './enumerate';
import { hashState } from './hash';
import { solverStateFromLevel } from './levelState';
import { DEFAULT_ENUMERATE_OPTS, solveGameState } from './solverCore';
import type { LevelData } from '../../types';

export type DifficultyStatus = 'ok' | 'invalid' | 'empty';

export interface DifficultyTrapDepth {
  depth: number;
  totalActions: number;
  trapActions: number;
  unknownActions: number;
}

export interface DifficultyFatalMove {
  action: Action;
  reason: string;
}

export interface DifficultyStats {
  statesClassified: number;
  cacheHits: number;
  elapsedMs: number;
  perStateMaxStates: number;
  perStateMaxMs: number;
  totalMaxMs: number;
}

export interface DifficultyResult {
  status: DifficultyStatus;
  message?: string;
  // null = no fatal action found within the searched depth.
  // 0    = initial state already unsolvable.
  // d>=1 = smallest decision depth at which some legal action leads to an
  //        unsolvable continuation. "Decision depth" counts only states with
  //        ≥2 legal actions; forced moves are collapsed transparently.
  failureHorizon: number | null;
  // Deepest decision depth whose layer was fully classified. If failureHorizon
  // is null and !truncated, the level is provably safe up to searchedDepth.
  searchedDepth: number;
  depthLimit: number;
  trapsByDepth: DifficultyTrapDepth[];
  worstFirstMoves: DifficultyFatalMove[];
  initialSolvable: boolean | null;
  initialMovesUsed: number | null;
  truncated: boolean;
  stats: DifficultyStats;
}

export interface DifficultyOptions {
  depth?: number;
  perStateMaxStates?: number;
  perStateMaxMs?: number;
  totalMaxMs?: number;
}

export const AUTO_DIFFICULTY_OPTIONS: Required<DifficultyOptions> = {
  depth: 3,
  perStateMaxStates: 50_000,
  perStateMaxMs: 10_000,
  totalMaxMs: 10_000,
};

export const DEEP_DIFFICULTY_OPTIONS: Required<DifficultyOptions> = {
  depth: 50,
  perStateMaxStates: 1_000_000,
  perStateMaxMs: 17_000,
  totalMaxMs: 60_000,
};

interface QueueEntry {
  state: GameState;
  hash: string;
}

export function analyzeDifficultyLevel(
  level: LevelData,
  opts: DifficultyOptions = {},
): DifficultyResult {
  const startedAt = performance.now();
  const cfg: Required<DifficultyOptions> = { ...AUTO_DIFFICULTY_OPTIONS, ...opts };

  const buildStats = (
    statesClassified: number,
    cacheHits: number,
  ): DifficultyStats => ({
    statesClassified,
    cacheHits,
    elapsedMs: performance.now() - startedAt,
    perStateMaxStates: cfg.perStateMaxStates,
    perStateMaxMs: cfg.perStateMaxMs,
    totalMaxMs: cfg.totalMaxMs,
  });

  const emptyResult = (
    status: DifficultyStatus,
    message?: string,
  ): DifficultyResult => ({
    status,
    message,
    failureHorizon: null,
    searchedDepth: 0,
    depthLimit: cfg.depth,
    trapsByDepth: [],
    worstFirstMoves: [],
    initialSolvable: null,
    initialMovesUsed: null,
    truncated: false,
    stats: buildStats(0, 0),
  });

  if ((level.board?.length ?? 0) === 0 && (level.stock?.length ?? 0) === 0) {
    return emptyResult('empty');
  }

  let initialState: GameState;
  try {
    initialState = solverStateFromLevel(level);
  } catch (err) {
    return emptyResult('invalid', err instanceof Error ? err.message : String(err));
  }

  const cache = new Map<string, boolean>();
  let statesClassified = 0;
  let cacheHits = 0;
  let truncated = false;

  const remainingMs = (): number => cfg.totalMaxMs - (performance.now() - startedAt);

  const classify = (state: GameState, hash: string): boolean | null => {
    const cached = cache.get(hash);
    if (cached !== undefined) {
      cacheHits++;
      return cached;
    }
    if (isWon(state)) {
      cache.set(hash, true);
      return true;
    }
    const budget = Math.min(cfg.perStateMaxMs, remainingMs());
    if (budget <= 0) {
      truncated = true;
      return null;
    }
    statesClassified++;
    const r = solveGameState(state, {
      maxStates: cfg.perStateMaxStates,
      maxMs: budget,
      solvableCache: cache,
    });
    if (r.status === 'solved') return true;
    if (r.status === 'unsolvable') return false;
    if (r.status === 'timeout') truncated = true;
    return null;
  };

  const initHash = hashState(initialState);
  let initialClassification: boolean | null;
  let initialMovesUsed: number | null = null;
  if (isWon(initialState)) {
    initialClassification = true;
    initialMovesUsed = 0;
    cache.set(initHash, true);
  } else {
    statesClassified++;
    const initRun = solveGameState(initialState, {
      maxStates: cfg.perStateMaxStates,
      maxMs: Math.min(cfg.perStateMaxMs, remainingMs()),
      solvableCache: cache,
    });
    if (initRun.status === 'solved') {
      initialClassification = true;
      initialMovesUsed = initRun.movesUsed ?? null;
    } else if (initRun.status === 'unsolvable') {
      initialClassification = false;
    } else {
      initialClassification = null;
      if (initRun.status === 'timeout') truncated = true;
    }
  }

  if (initialClassification === false) {
    return {
      status: 'ok',
      failureHorizon: 0,
      searchedDepth: 0,
      depthLimit: cfg.depth,
      trapsByDepth: [],
      worstFirstMoves: [],
      initialSolvable: false,
      initialMovesUsed: null,
      truncated,
      stats: buildStats(statesClassified, cacheHits),
    };
  }

  const decisionRoot = collapseForced(initialState, initHash);

  const trapsByDepth: DifficultyTrapDepth[] = [];
  const worstFirstMoves: DifficultyFatalMove[] = [];
  let failureHorizon: number | null = null;
  let searchedDepth = 0;

  const seenInBfs = new Set<string>([decisionRoot.hash]);
  let frontier: QueueEntry[] = [{ state: decisionRoot.state, hash: decisionRoot.hash }];

  for (let depth = 1; depth <= cfg.depth; depth++) {
    if (frontier.length === 0) break;
    if (remainingMs() <= 0) {
      truncated = true;
      break;
    }
    const layerStats: DifficultyTrapDepth = {
      depth,
      totalActions: 0,
      trapActions: 0,
      unknownActions: 0,
    };
    const nextFrontier: QueueEntry[] = [];
    let layerTimedOut = false;

    for (const node of frontier) {
      if (remainingMs() <= 0) {
        truncated = true;
        layerTimedOut = true;
        break;
      }
      if (isWon(node.state)) continue;
      const actions = enumerateMoves(node.state, DEFAULT_ENUMERATE_OPTS);
      if (actions.length === 0) continue;

      for (const action of actions) {
        let rawChild: GameState;
        try {
          rawChild = applyAction(node.state, action);
        } catch {
          continue;
        }
        const collapsed = collapseForced(rawChild, hashState(rawChild));
        const classification = classify(collapsed.state, collapsed.hash);

        layerStats.totalActions++;
        if (classification === false) {
          layerStats.trapActions++;
          if (depth === 1) {
            worstFirstMoves.push({
              action,
              reason: describeAction(node.state, action),
            });
          }
        } else if (classification === null) {
          layerStats.unknownActions++;
        }

        if (
          classification === true &&
          !seenInBfs.has(collapsed.hash) &&
          depth < cfg.depth
        ) {
          seenInBfs.add(collapsed.hash);
          nextFrontier.push({ state: collapsed.state, hash: collapsed.hash });
        }
      }
    }

    trapsByDepth.push(layerStats);

    if (!layerTimedOut) {
      searchedDepth = depth;
    }

    if (layerStats.trapActions > 0) {
      failureHorizon = depth;
      break;
    }

    if (layerTimedOut) break;

    frontier = nextFrontier;
  }

  return {
    status: 'ok',
    failureHorizon,
    searchedDepth,
    depthLimit: cfg.depth,
    trapsByDepth,
    worstFirstMoves,
    initialSolvable: true,
    initialMovesUsed,
    truncated,
    stats: buildStats(statesClassified, cacheHits),
  };
}

function collapseForced(
  state: GameState,
  hash: string,
): { state: GameState; hash: string } {
  let s = state;
  let h = hash;
  const seen = new Set<string>([h]);
  while (true) {
    if (isWon(s)) return { state: s, hash: h };
    const moves = enumerateMoves(s, DEFAULT_ENUMERATE_OPTS);
    if (moves.length !== 1) return { state: s, hash: h };
    let next: GameState;
    try {
      next = applyAction(s, moves[0]);
    } catch {
      return { state: s, hash: h };
    }
    const nh = hashState(next);
    if (seen.has(nh)) return { state: next, hash: nh };
    seen.add(nh);
    s = next;
    h = nh;
  }
}

export function describeAction(state: GameState, action: Action): string {
  switch (action.type) {
    case 'DRAW':
      return 'Draw from stock';
    case 'HAND_TO_CATEGORY': {
      const slotN = action.slotIndex + 1;
      const hand = state.hand;
      const slot = state.categorySlots[action.slotIndex];
      if (!hand) return `Place hand into slot ${slotN}`;
      if (slot && slot.lockedCategory === null) {
        return `Lock slot ${slotN} to category ${hand.category}`;
      }
      const label = hand.isCategory ? hand.category : hand.category.toLowerCase();
      return `Feed ${label} from hand into slot ${slotN}`;
    }
    case 'BOARD_TO_CATEGORY': {
      const slotN = action.slotIndex + 1;
      const src = state.boardSlots.find(
        (s) => s.x === action.from.x && s.y === action.from.y,
      );
      const slot = state.categorySlots[action.slotIndex];
      if (!src) return `Move board (${action.from.x}, ${action.from.y}) to slot ${slotN}`;
      const chain = getChainEntries(src);
      if (chain.length === 0) {
        return `Move board (${action.from.x}, ${action.from.y}) to slot ${slotN}`;
      }
      const top = chain[chain.length - 1].card;
      if (slot && slot.lockedCategory === null) {
        return `Lock slot ${slotN} to category ${top.category} via board (${action.from.x}, ${action.from.y})`;
      }
      const label = top.isCategory ? top.category : top.category.toLowerCase();
      if (chain.length > 1) {
        return `Move stack at (${action.from.x}, ${action.from.y}) — top ${label} — to slot ${slotN}`;
      }
      return `Move ${label} at (${action.from.x}, ${action.from.y}) to slot ${slotN}`;
    }
  }
}
