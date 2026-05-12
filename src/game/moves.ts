import type {
  Action,
  BoardCardEntry,
  BoardSlot,
  Card,
  CategorySlot,
  GameState,
  LevelData,
} from '../types';
import {
  findSlot,
  getChainEntries,
  isEmptyFloorPlaceable,
  isSlotInteractive,
} from './coverage';

export function canPlaceInCategorySlot(card: Card, slot: CategorySlot): boolean {
  if (slot.lockedCategory === null) return card.isCategory;
  return !card.isCategory && card.category === slot.lockedCategory;
}

export function canPlaceOnBoardCard(source: Card, targetTop: Card): boolean {
  if (source.category !== targetTop.category) return false;
  if (source.isCategory && targetTop.isCategory) return false;
  return true;
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

// True if the chain rooted at sourceSlot has any legal destination. Chain-of-1
// follows single-card rules; longer chains can only target an empty category
// slot when their top is a category card, and a board slot whose top accepts
// the chain bottom (same single-card matching rule).
export function hasValidMoveForBoardSlot(
  sourceSlot: BoardSlot,
  state: GameState,
): boolean {
  const chain = getChainEntries(sourceSlot);
  if (chain.length === 0) return false;
  const chainBottom = chain[0].card;
  const chainTop = chain[chain.length - 1].card;

  for (const catSlot of state.categorySlots) {
    if (chain.length === 1) {
      if (canPlaceInCategorySlot(chainTop, catSlot)) return true;
    } else if (catSlot.lockedCategory === null && chainTop.isCategory) {
      return true;
    }
  }
  for (const slot of state.boardSlots) {
    if (slot === sourceSlot) continue;
    if (slot.cards.length === 0) {
      if (isEmptyFloorPlaceable(slot, state.boardSlots)) return true;
      continue;
    }
    if (!isSlotInteractive(slot, state.boardSlots)) continue;
    const targetTop = slot.cards[slot.cards.length - 1].card;
    if (canPlaceOnBoardCard(chainBottom, targetTop)) return true;
  }
  return false;
}

export function hasValidMoveForHandCard(card: Card, state: GameState): boolean {
  for (const catSlot of state.categorySlots) {
    if (canPlaceInCategorySlot(card, catSlot)) return true;
  }
  for (const slot of state.boardSlots) {
    if (slot.cards.length === 0) {
      if (isEmptyFloorPlaceable(slot, state.boardSlots)) return true;
      continue;
    }
    if (!isSlotInteractive(slot, state.boardSlots)) continue;
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

  if (catSlot.lockedCategory !== null) {
    throw new Error('A chain can only land on an empty category slot');
  }
  if (!chainTop.isCategory) {
    throw new Error('Chain top must be a category card to lock a category slot');
  }
  const newBoardSlots = removeChainFromSlot(state.boardSlots, sourceSlot, chain.length);
  return placeChainInCategorySlot(
    { ...state, boardSlots: newBoardSlots },
    slotIndex,
    chain,
  );
}

function applyHandToBoard(
  state: GameState,
  to: { x: number; y: number },
): GameState {
  if (state.hand === null) throw new Error('Hand empty');
  const targetSlot = findSlot(state.boardSlots, to.x, to.y);
  if (!targetSlot) throw new Error('Target slot not found');
  const handCard = state.hand;
  const newBoardSlots = placeChainOnBoardSlot(
    state.boardSlots,
    targetSlot,
    [{ card: handCard, z: 0, revealed: true }],
  );
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
  const chain = getChainEntries(sourceSlot);
  const placedSlots = placeChainOnBoardSlot(state.boardSlots, targetSlot, chain);
  const newBoardSlots = removeChainFromSlot(placedSlots, sourceSlot, chain.length);
  return {
    ...state,
    boardSlots: newBoardSlots,
    movesUsed: state.movesUsed + 1,
  };
}

// Validate destination + append the chain to it, returning a new slots array.
// Chain bottom must satisfy the standard single-card placement rule; the
// auto-swap rule (category card stays on top) is applied inside append.
function placeChainOnBoardSlot(
  slots: BoardSlot[],
  targetSlot: BoardSlot,
  chain: BoardCardEntry[],
): BoardSlot[] {
  if (chain.length === 0) throw new Error('Empty chain');
  const chainBottom = chain[0].card;
  if (targetSlot.cards.length === 0) {
    if (!isEmptyFloorPlaceable(targetSlot, slots)) {
      throw new Error('Target unavailable');
    }
  } else {
    if (!isSlotInteractive(targetSlot, slots)) throw new Error('Target not interactive');
    const top = targetSlot.cards[targetSlot.cards.length - 1].card;
    if (!canPlaceOnBoardCard(chainBottom, top)) {
      throw new Error('Categories do not match');
    }
  }
  return slots.map((s) => (s === targetSlot ? appendChainToSlot(s, chain) : s));
}

// Append chain entries to a slot, re-assigning z values from the slot's
// current top (or floor). If the slot's top is the matching category card and
// the chain's top is a simple card, the category card floats above the new
// entries so it always stays on top of its chain.
function appendChainToSlot(slot: BoardSlot, chain: BoardCardEntry[]): BoardSlot {
  if (chain.length === 0) return slot;
  const baseZ = slot.cards.length === 0
    ? slot.floorZ
    : slot.cards[slot.cards.length - 1].z + 1;
  const rezed: BoardCardEntry[] = chain.map((e, i) => ({
    card: e.card,
    z: baseZ + i,
    revealed: true,
  }));
  if (slot.cards.length > 0) {
    const top = slot.cards[slot.cards.length - 1];
    const incomingTop = rezed[rezed.length - 1];
    if (
      top.card.isCategory &&
      !incomingTop.card.isCategory &&
      top.card.category === incomingTop.card.category
    ) {
      const shifted = rezed.map((e) => ({ card: e.card, z: e.z - 1, revealed: true }));
      const liftedTop: BoardCardEntry = {
        card: top.card,
        z: baseZ + rezed.length - 1,
        revealed: true,
      };
      return {
        ...slot,
        cards: [...slot.cards.slice(0, -1), ...shifted, liftedTop],
      };
    }
  }
  return { ...slot, cards: [...slot.cards, ...rezed] };
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
    return {
      ...s,
      cards: newCards,
      dead: newCards.length === 0 && s.floorZ !== 0 ? true : s.dead,
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

  return finalizeCategorySlot(state, slotIndex, newSlot, newConsumed);
}

// Lock an empty category slot with the chain's top (category card) and consume
// all simple cards below it in one move.
function placeChainInCategorySlot(
  state: GameState,
  slotIndex: number,
  chain: BoardCardEntry[],
): GameState {
  const categoryCard = chain[chain.length - 1].card;
  if (!categoryCard.isCategory) throw new Error('Internal: chain top must be category card');
  const simples = chain.slice(0, -1).map((e) => e.card);
  const newConsumed = simples.length === 0
    ? state.consumedSimple
    : [...state.consumedSimple, ...simples];
  const newSlot: CategorySlot = {
    lockedCategory: categoryCard.category,
    displayedCard: simples.length > 0 ? simples[simples.length - 1] : categoryCard,
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
