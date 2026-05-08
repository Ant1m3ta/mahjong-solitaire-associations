import type { BoardSlot, CategorySlot, GameState, LevelData } from '../types';
import { createCardFromId, resetUidForLevel } from './cards';

export function buildInitialState(level: LevelData): GameState {
  resetUidForLevel();

  const stock = level.stock.map((id) => createCardFromId(level, id));

  const slotMap = new Map<string, BoardSlot>();
  for (const data of level.board) {
    const key = `${data.x},${data.y}`;
    let slot = slotMap.get(key);
    if (!slot) {
      slot = { x: data.x, y: data.y, cards: [], dead: false };
      slotMap.set(key, slot);
    }
    const card = createCardFromId(level, data.cardId);
    slot.cards.push({ card, z: data.z });
  }
  for (const slot of slotMap.values()) {
    slot.cards.sort((a, b) => a.z - b.z);
  }

  const categorySlots: CategorySlot[] = [];
  for (let i = 0; i < level.slotsDefault; i++) {
    categorySlots.push({
      lockedCategory: null,
      displayedCard: null,
      cardsConsumed: 0,
    });
  }

  return {
    level,
    stock,
    hand: null,
    categorySlots,
    boardSlots: Array.from(slotMap.values()),
    consumedSimple: [],
    movesUsed: 0,
    movesLimit: level.movesLimit,
    bonusSlotUsed: false,
  };
}
