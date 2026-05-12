import type { LevelData } from '../types';
import type { CardKind, SkeletonBoardCard, SkeletonCategory, SkeletonLevel, SkeletonStockEntry } from './types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class UnfillError extends Error {}

interface CategoryInfo {
  categoryId: string;
  wordIds: Set<string>;
  letter: string;
  simpleCount: number;
}

export function unfillLevel(level: LevelData): SkeletonLevel {
  if (level.categories.length > LETTERS.length) {
    throw new UnfillError(`Level has ${level.categories.length} categories; editor supports up to ${LETTERS.length}.`);
  }

  const byCategoryId = new Map<string, CategoryInfo>();
  level.categories.forEach((cat, i) => {
    byCategoryId.set(cat.categoryId, {
      categoryId: cat.categoryId,
      wordIds: new Set(cat.wordsData.map((w) => w.wordId)),
      letter: LETTERS[i],
      simpleCount: 0,
    });
  });

  // wordId → CategoryInfo. Words must be globally unique across categories;
  // existing LevelData files satisfy this (the createCardFromId resolver does).
  const byWordId = new Map<string, CategoryInfo>();
  for (const info of byCategoryId.values()) {
    for (const w of info.wordIds) {
      if (byWordId.has(w)) {
        throw new UnfillError(`Word "${w}" appears in multiple categories; ambiguous.`);
      }
      byWordId.set(w, info);
    }
  }

  function classify(cardId: string): { info: CategoryInfo; kind: CardKind } {
    const cat = byCategoryId.get(cardId);
    if (cat) return { info: cat, kind: 'category' };
    const w = byWordId.get(cardId);
    if (w) return { info: w, kind: 'simple' };
    throw new UnfillError(`Card "${cardId}" is neither a categoryId nor a known wordId.`);
  }

  const board: SkeletonBoardCard[] = level.board.map((b) => {
    const { info, kind } = classify(b.cardId);
    if (kind === 'simple') info.simpleCount++;
    return { x: b.x, y: b.y, z: b.z, letter: info.letter, kind };
  });

  const stock: SkeletonStockEntry[] = level.stock.map((cardId) => {
    const { info, kind } = classify(cardId);
    if (kind === 'simple') info.simpleCount++;
    return { letter: info.letter, kind };
  });

  const categories: SkeletonCategory[] = level.categories.map((cat) => {
    const info = byCategoryId.get(cat.categoryId)!;
    return {
      letter: info.letter,
      simpleCards: info.simpleCount,
      pinnedCategoryId: cat.categoryId,
    };
  });

  return {
    levelId: level.levelId,
    slotsDefault: level.slotsDefault,
    movesLimit: level.movesLimit,
    categories,
    board,
    stock,
  };
}
