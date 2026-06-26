import type { GameState, LevelData } from '../../types';
import { buildInitialState } from '../../game/init';

// Build a solver GameState directly from a concrete LevelData — the same path
// the real game uses (buildInitialState), so win / auto-clear count simples the
// way the game does (by wordsData length). The move limit is stripped and the
// bonus slot marked spent so the analyzers measure intrinsic difficulty (no
// move cap, no bonus-slot exploration), matching the retired skeleton builder.
export function solverStateFromLevel(level: LevelData): GameState {
  // Match the retired skeleton builder's slot ordering: it sorted the board by
  // (x,y,z) before grouping into slots, which determines the solver/greedy's
  // board-order tie-break. buildInitialState preserves on-disk board order, so
  // sort here to keep the analysis identical regardless of authored card order
  // (a uniform normalize shift preserves this order, so it stays consistent).
  const sortedBoard = [...level.board].sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return a.z - b.z;
  });
  const state = buildInitialState({ ...level, board: sortedBoard });
  return { ...state, movesUsed: 0, movesLimit: -1, bonusSlotUsed: true };
}
