import type { BoardSlot, CategorySlot, GameState, LevelData } from '../types';
import { createCardFromId, resetUidForLevel } from './cards';
import { normalizeLevel } from './normalize';

export function buildInitialState(rawLevel: LevelData): GameState {
  resetUidForLevel();

  const level = normalizeLevel(rawLevel);
  const stock = level.stock.map((id) => createCardFromId(level, id));

  const slotMap = new Map<string, BoardSlot>();
  for (const data of level.board) {
    const key = `${data.x},${data.y}`;
    let slot = slotMap.get(key);
    if (!slot) {
      slot = { x: data.x, y: data.y, cards: [] };
      slotMap.set(key, slot);
    }
    const card = createCardFromId(level, data.cardId);
    slot.cards.push({ card, z: data.z, revealed: false });
  }
  for (const slot of slotMap.values()) {
    slot.cards.sort((a, b) => a.z - b.z);
    if (slot.cards.length > 0) {
      const topIdx = slot.cards.length - 1;
      slot.cards[topIdx] = { ...slot.cards[topIdx], revealed: true };
    }
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
