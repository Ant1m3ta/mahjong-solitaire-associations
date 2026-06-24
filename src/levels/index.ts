import type { LevelData } from '../types';
import { playOrderRank } from './order';

const modules = import.meta.glob<{ default: LevelData }>('./*.json', { eager: true });

export const LEVELS: LevelData[] = Object.entries(modules)
  // order.json is the play-order array, not a level — keep it out of LEVELS.
  .filter(([path]) => path !== './order.json')
  .map(([path, mod]) => ({ path, level: mod.default }))
  .sort(
    (a, b) =>
      playOrderRank(a.level.levelId) - playOrderRank(b.level.levelId) ||
      a.path.localeCompare(b.path, undefined, { numeric: true }),
  )
  .map(({ level }) => level);
