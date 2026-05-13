import type { LevelData } from '../types';

const modules = import.meta.glob<{ default: LevelData }>('./*.json', { eager: true });

export const LEVELS: LevelData[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, mod]) => mod.default);
