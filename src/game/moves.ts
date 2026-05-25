import type {
  Action,
  BoardCardEntry,
  BoardSlot,
  Card,
  CategorySlot,
  GameState,
  LevelData,
} from '../types';
import { findSlot, getChainEntries, isSlotRevealed } from './coverage';

export function canPlaceInCategorySlot(card: Card, slot: CategorySlot): boolean {
  if (slot.lockedCategory === null) return card.isCategory;
  return card.category === slot.lockedCategory;
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

// True if the chain rooted at sourceSlot has any legal category-slot
// destination. Chain-of-1 follows single-card rules; longer chains can target
// any empty category slot or any locked category slot whose category matches
// the chain.
export function hasValidMoveForBoardSlot(
  sourceSlot: BoardSlot,
  state: GameState,
): boolean {
  const chain = getChainEntries(sourceSlot);
  if (chain.length === 0) return false;
  const chainTop = chain[chain.length - 1].card;

  for (const catSlot of state.categorySlots) {
    if (chain.length === 1) {
      if (canPlaceInCategorySlot(chainTop, catSlot)) return true;
      continue;
    }
    if (catSlot.lockedCategory === null) return true;
    if (chainTop.category === catSlot.lockedCategory) return true;
  }
  return false;
}

export function hasValidMoveForHandCard(card: Card, state: GameState): boolean {
  for (const catSlot of state.categorySlots) {
    if (canPlaceInCategorySlot(card, catSlot)) return true;
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
    case 'BOARD_TO_CATEGORY':
      return applyBoardToCategory(state, action.from, action.slotIndex);
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
  if (!isSlotRevealed(sourceSlot, state.boardSlots)) throw new Error('Source not interactive');
  const chain = getChainEntries(sourceSlot);
  const chainTop = chain[chain.length - 1].card;
  const catSlot = state.categorySlots[slotIndex];
  if (!catSlot) throw new Error('Invalid slot index');

  if (chain.length === 1) {
    if (!canPlaceInCategorySlot(chainTop, catSlot)) {
      throw new Error('Cannot place this card in this category slot');
    }
    const newBoardSlots = removeChainFromSlot(state.boardSlots, sourceSlot, 1);
    return placeCardInCategorySlot(
      { ...state, boardSlots: newBoardSlots },
      slotIndex,
      chainTop,
    );
  }

  if (catSlot.lockedCategory === null) {
    const newBoardSlots = removeChainFromSlot(state.boardSlots, sourceSlot, chain.length);
    return placeChainInCategorySlot(
      { ...state, boardSlots: newBoardSlots },
      slotIndex,
      chain,
    );
  }

  if (chainTop.category !== catSlot.lockedCategory) {
    throw new Error('Category mismatch');
  }
  const newBoardSlots = removeChainFromSlot(state.boardSlots, sourceSlot, chain.length);
  return consumeChainInCategorySlot(
    { ...state, boardSlots: newBoardSlots },
    slotIndex,
    chain.map((e) => e.card),
  );
}

function removeChainFromSlot(
  slots: BoardSlot[],
  target: BoardSlot,
  count: number,
): BoardSlot[] {
  if (count <= 0) return slots;
  return slots.map((s) => {
    if (s !== target) return s;
    const newCards = s.cards.slice(0, s.cards.length - count);
    if (newCards.length > 0) {
      const lastIdx = newCards.length - 1;
      if (!newCards[lastIdx].revealed) {
        newCards[lastIdx] = { ...newCards[lastIdx], revealed: true };
      }
    }
    return { ...s, cards: newCards };
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
    newSlot = {
      lockedCategory: card.category,
      displayedCard: card,
      cardsConsumed: card.isCategory ? 0 : 1,
    };
    if (!card.isCategory) {
      newConsumed = [...state.consumedSimple, card];
    }
  } else {
    if (card.category !== slot.lockedCategory) throw new Error('Category mismatch');
    if (card.isCategory) {
      newSlot = { ...slot, displayedCard: card };
    } else {
      newSlot = {
        ...slot,
        displayedCard: card,
        cardsConsumed: slot.cardsConsumed + 1,
      };
      newConsumed = [...state.consumedSimple, card];
    }
  }

  return finalizeCategorySlot(state, slotIndex, newSlot, newConsumed);
}

// Consume a chain into an already-locked category slot in a single move. The
// caller guarantees every chain entry shares the locked category. Simples are
// consumed; any category cards fold into the locker without consuming.
function consumeChainInCategorySlot(
  state: GameState,
  slotIndex: number,
  cards: Card[],
): GameState {
  const slot = state.categorySlots[slotIndex];
  const simples = cards.filter((c) => !c.isCategory);
  const newConsumed = simples.length === 0
    ? state.consumedSimple
    : [...state.consumedSimple, ...simples];
  const newSlot: CategorySlot = {
    ...slot,
    displayedCard: simples.length > 0
      ? simples[simples.length - 1]
      : cards[cards.length - 1],
    cardsConsumed: slot.cardsConsumed + simples.length,
  };
  return finalizeCategorySlot(state, slotIndex, newSlot, newConsumed);
}

// Lock an empty category slot with the chain in one move. Any category card in
// the chain folds into the slot's locker; every simple in the chain is
// consumed. Chain top can be either a category card or a simple — chain
// invariant guarantees a single category for the whole chain.
function placeChainInCategorySlot(
  state: GameState,
  slotIndex: number,
  chain: BoardCardEntry[],
): GameState {
  const lockingCategory = chain[chain.length - 1].card.category;
  const simples = chain.filter((e) => !e.card.isCategory).map((e) => e.card);
  const categoryCardInChain = chain.find((e) => e.card.isCategory)?.card;
  const newConsumed = simples.length === 0
    ? state.consumedSimple
    : [...state.consumedSimple, ...simples];
  const displayedCard = simples.length > 0
    ? simples[simples.length - 1]
    : (categoryCardInChain ?? chain[chain.length - 1].card);
  const newSlot: CategorySlot = {
    lockedCategory: lockingCategory,
    displayedCard,
    cardsConsumed: simples.length,
  };
  return finalizeCategorySlot(state, slotIndex, newSlot, newConsumed);
}

function finalizeCategorySlot(
  state: GameState,
  slotIndex: number,
  newSlot: CategorySlot,
  newConsumed: Card[],
): GameState {
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
