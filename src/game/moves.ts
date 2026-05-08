import type {
  Action,
  BoardSlot,
  Card,
  CategorySlot,
  GameState,
  LevelData,
} from '../types';
import { findSlot, isSlotInteractive } from './coverage';

export function canPlaceInCategorySlot(card: Card, slot: CategorySlot): boolean {
  if (slot.lockedCategory === null) return card.isCategory;
  return !card.isCategory && card.category === slot.lockedCategory;
}

export function canPlaceOnBoardCard(source: Card, targetTop: Card): boolean {
  if (targetTop.isCategory) return false;
  return source.category === targetTop.category;
}

function countSimpleCardsInCategory(level: LevelData, categoryId: string): number {
  const cat = level.categories.find((c) => c.categoryId === categoryId);
  return cat ? cat.wordsData.length : 0;
}

function totalSimpleInLevel(level: LevelData): number {
  return level.categories.reduce((sum, c) => sum + c.wordsData.length, 0);
}

export function isWon(state: GameState): boolean {
  return state.consumedSimple.length >= totalSimpleInLevel(state.level);
}

export function hasMovesLeft(state: GameState): boolean {
  return state.movesLimit < 0 || state.movesUsed < state.movesLimit;
}

export function isLost(state: GameState): boolean {
  if (isWon(state)) return false;
  return !hasMovesLeft(state);
}

export function hasValidMoveForBoardCard(
  card: Card,
  sourceSlot: BoardSlot,
  state: GameState,
): boolean {
  for (const catSlot of state.categorySlots) {
    if (canPlaceInCategorySlot(card, catSlot)) return true;
  }
  for (const slot of state.boardSlots) {
    if (slot === sourceSlot) continue;
    if (!isSlotInteractive(slot, state.boardSlots)) continue;
    if (slot.cards.length === 0) continue;
    const targetTop = slot.cards[slot.cards.length - 1].card;
    if (canPlaceOnBoardCard(card, targetTop)) return true;
  }
  return false;
}

export function hasValidMoveForHandCard(card: Card, state: GameState): boolean {
  for (const catSlot of state.categorySlots) {
    if (canPlaceInCategorySlot(card, catSlot)) return true;
  }
  for (const slot of state.boardSlots) {
    if (!isSlotInteractive(slot, state.boardSlots)) continue;
    if (slot.cards.length === 0) continue;
    const targetTop = slot.cards[slot.cards.length - 1].card;
    if (canPlaceOnBoardCard(card, targetTop)) return true;
  }
  return false;
}

export function applyAction(state: GameState, action: Action): GameState {
  if (!hasMovesLeft(state)) {
    throw new Error('No moves left');
  }
  switch (action.type) {
    case 'DRAW':
      return applyDraw(state);
    case 'HAND_TO_CATEGORY':
      return applyHandToCategory(state, action.slotIndex);
    case 'HAND_TO_BOARD':
      return applyHandToBoard(state, action.to);
    case 'BOARD_TO_CATEGORY':
      return applyBoardToCategory(state, action.from, action.slotIndex);
    case 'BOARD_TO_BOARD':
      return applyBoardToBoard(state, action.from, action.to);
  }
}

function applyDraw(state: GameState): GameState {
  if (state.stock.length === 0 && state.hand === null) {
    throw new Error('Stock and hand both empty');
  }
  let newStock = [...state.stock];
  let newHand = state.hand;
  if (newHand !== null) {
    newStock = [newHand, ...newStock];
    newHand = null;
  }
  if (newStock.length === 0) {
    throw new Error('Nothing to draw');
  }
  newHand = newStock[newStock.length - 1];
  newStock = newStock.slice(0, -1);
  return {
    ...state,
    stock: newStock,
    hand: newHand,
    movesUsed: state.movesUsed + 1,
  };
}

function applyHandToCategory(state: GameState, slotIndex: number): GameState {
  if (state.hand === null) throw new Error('Hand empty');
  const slot = state.categorySlots[slotIndex];
  if (!slot) throw new Error('Invalid slot index');
  const card = state.hand;
  if (!canPlaceInCategorySlot(card, slot)) {
    throw new Error('Cannot place hand card here');
  }
  return placeCardInCategorySlot(
    { ...state, hand: null },
    slotIndex,
    card,
  );
}

function applyBoardToCategory(
  state: GameState,
  from: { x: number; y: number },
  slotIndex: number,
): GameState {
  const sourceSlot = findSlot(state.boardSlots, from.x, from.y);
  if (!sourceSlot) throw new Error('Source slot not found');
  if (!isSlotInteractive(sourceSlot, state.boardSlots)) throw new Error('Source not interactive');
  const top = sourceSlot.cards[sourceSlot.cards.length - 1].card;
  const catSlot = state.categorySlots[slotIndex];
  if (!catSlot) throw new Error('Invalid slot index');
  if (!canPlaceInCategorySlot(top, catSlot)) {
    throw new Error('Cannot place this card in this category slot');
  }
  const newBoardSlots = removeTopFromSlot(state.boardSlots, sourceSlot);
  return placeCardInCategorySlot(
    { ...state, boardSlots: newBoardSlots },
    slotIndex,
    top,
  );
}

function applyHandToBoard(
  state: GameState,
  to: { x: number; y: number },
): GameState {
  if (state.hand === null) throw new Error('Hand empty');
  const targetSlot = findSlot(state.boardSlots, to.x, to.y);
  if (!targetSlot) throw new Error('Target slot not found');
  if (!isSlotInteractive(targetSlot, state.boardSlots)) throw new Error('Target not interactive');
  if (targetSlot.cards.length === 0 || targetSlot.dead) throw new Error('Target unavailable');
  const handCard = state.hand;
  const targetTop = targetSlot.cards[targetSlot.cards.length - 1];
  if (!canPlaceOnBoardCard(handCard, targetTop.card)) {
    throw new Error('Categories do not match');
  }
  const newZ = targetTop.z + 1;
  const newBoardSlots = state.boardSlots.map((s) => {
    if (s === targetSlot) {
      return {
        ...s,
        cards: [...s.cards, { card: handCard, z: newZ }],
      };
    }
    return s;
  });
  return {
    ...state,
    hand: null,
    boardSlots: newBoardSlots,
    movesUsed: state.movesUsed + 1,
  };
}

function applyBoardToBoard(
  state: GameState,
  from: { x: number; y: number },
  to: { x: number; y: number },
): GameState {
  const sourceSlot = findSlot(state.boardSlots, from.x, from.y);
  const targetSlot = findSlot(state.boardSlots, to.x, to.y);
  if (!sourceSlot || !targetSlot) throw new Error('Slot not found');
  if (sourceSlot === targetSlot) throw new Error('Same slot');
  if (!isSlotInteractive(sourceSlot, state.boardSlots)) throw new Error('Source not interactive');
  if (!isSlotInteractive(targetSlot, state.boardSlots)) throw new Error('Target not interactive');
  if (targetSlot.cards.length === 0 || targetSlot.dead) throw new Error('Target unavailable');
  const sourceTop = sourceSlot.cards[sourceSlot.cards.length - 1];
  const targetTop = targetSlot.cards[targetSlot.cards.length - 1];
  if (!canPlaceOnBoardCard(sourceTop.card, targetTop.card)) {
    throw new Error('Categories do not match');
  }
  const newZ = targetTop.z + 1;
  const newBoardSlots = state.boardSlots.map((s) => {
    if (s === sourceSlot) {
      const newCards = s.cards.slice(0, -1);
      return {
        ...s,
        cards: newCards,
        dead: newCards.length === 0 ? true : s.dead,
      };
    }
    if (s === targetSlot) {
      return {
        ...s,
        cards: [...s.cards, { card: sourceTop.card, z: newZ }],
      };
    }
    return s;
  });
  return {
    ...state,
    boardSlots: newBoardSlots,
    movesUsed: state.movesUsed + 1,
  };
}

function removeTopFromSlot(slots: BoardSlot[], target: BoardSlot): BoardSlot[] {
  return slots.map((s) => {
    if (s !== target) return s;
    const newCards = s.cards.slice(0, -1);
    return {
      ...s,
      cards: newCards,
      dead: newCards.length === 0 ? true : s.dead,
    };
  });
}

function placeCardInCategorySlot(
  state: GameState,
  slotIndex: number,
  card: Card,
): GameState {
  const slot = state.categorySlots[slotIndex];
  let newSlot: CategorySlot;
  let newConsumed = state.consumedSimple;

  if (slot.lockedCategory === null) {
    if (!card.isCategory) throw new Error('Empty slot needs category card');
    newSlot = {
      lockedCategory: card.category,
      displayedCard: card,
      cardsConsumed: 0,
    };
  } else {
    if (card.isCategory) throw new Error('Occupied slot rejects category cards');
    if (card.category !== slot.lockedCategory) throw new Error('Category mismatch');
    newSlot = {
      ...slot,
      displayedCard: card,
      cardsConsumed: slot.cardsConsumed + 1,
    };
    newConsumed = [...state.consumedSimple, card];
  }

  let newCategorySlots = state.categorySlots.map((s, i) =>
    i === slotIndex ? newSlot : s,
  );

  if (newSlot.lockedCategory !== null) {
    const totalForCategory = countSimpleCardsInCategory(state.level, newSlot.lockedCategory);
    const consumedForCategory = newConsumed.filter(
      (c) => c.category === newSlot.lockedCategory,
    ).length;
    if (consumedForCategory >= totalForCategory) {
      newCategorySlots = newCategorySlots.map((s, i) =>
        i === slotIndex
          ? { lockedCategory: null, displayedCard: null, cardsConsumed: 0 }
          : s,
      );
    }
  }

  return {
    ...state,
    categorySlots: newCategorySlots,
    consumedSimple: newConsumed,
    movesUsed: state.movesUsed + 1,
  };
}
