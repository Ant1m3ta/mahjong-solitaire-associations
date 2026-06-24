import orderRaw from './order.json';

// Canonical PLAY order — a verbatim mirror of the Unity LevelOrder/default.json
// array of levelIds, kept in lockstep by order-by-difficulty.ts and tune-levels.ts
// (which write both files on --write). Everything that lists or processes levels
// orders by this; filename is only a tiebreak for levels absent here (legacy
// sandbox files, Tutorial).
export const PLAY_ORDER: string[] = orderRaw as string[];

const rank = new Map(PLAY_ORDER.map((id, i) => [id, i]));

// Play-order rank for a levelId; levels absent from the play order sort last.
export function playOrderRank(levelId: string): number {
  return rank.get(levelId) ?? Number.MAX_SAFE_INTEGER;
}
