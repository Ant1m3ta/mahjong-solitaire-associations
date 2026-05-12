import type { BoardSlot, Card, LevelData } from '../types';

let nextUid = 1;

export function makeUid(): string {
  return `c${nextUid++}`;
}

export function resetUidForLevel(): void {
  nextUid = 1;
}

export function countSimpleInCategory(level: LevelData, categoryId: string): number {
  const cat = level.categories.find((c) => c.categoryId === categoryId);
  return cat ? cat.wordsData.length : 0;
}

export function countSimpleInStackOfCategory(slot: BoardSlot, categoryId: string): number {
  let n = 0;
  for (const entry of slot.cards) {
    if (!entry.card.isCategory && entry.card.category === categoryId) n++;
  }
  return n;
}

export function createCardFromId(level: LevelData, cardId: string): Card {
  for (const cat of level.categories) {
    if (cat.categoryId === cardId) {
      return {
        uid: makeUid(),
        cardId,
        category: cat.categoryId,
        word: cat.categoryId,
        isCategory: true,
      };
    }
    for (const word of cat.wordsData) {
      if (word.wordId === cardId) {
        return {
          uid: makeUid(),
          cardId,
          category: cat.categoryId,
          word: word.wordId,
          isCategory: false,
          isIcon: word.icon ?? false,
          imageId: word.imageId,
        };
      }
    }
  }
  throw new Error(`Card '${cardId}' not found in level data`);
}
