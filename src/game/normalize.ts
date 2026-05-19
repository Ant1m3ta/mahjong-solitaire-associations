import type { LevelData } from '../types';

export function normalizeLevel(level: LevelData): LevelData {
  if (level.board.length === 0) return level;

  let minX = Infinity;
  let minY = Infinity;
  for (const c of level.board) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
  }
  if (minX === 0 && minY === 0) return level;

  return {
    ...level,
    board: level.board.map((c) => ({ ...c, x: c.x - minX, y: c.y - minY })),
  };
}
