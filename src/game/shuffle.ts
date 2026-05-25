import type { Card, CategorySlot, GameState } from '../types';
import { getChainEntries, isSlotRevealed } from './coverage';
import { canPlaceInCategorySlot } from './moves';

function hasValidSlotForCard(card: Card, slots: CategorySlot[]): boolean {
  return slots.some((s) => canPlaceInCategorySlot(card, s));
}

// Deadlock = no card currently in play (hand, stock, or a revealed board
// chain) has any legal destination. Since the only remaining placements go to
// category slots, an under-approximation: if any one card has a legal target
// right now, we're not deadlocked. (Buried board cards may still become
// unwinnable, but that requires deeper search.)
export function isDeadlocked(state: GameState): boolean {
  if (state.hand && hasValidSlotForCard(state.hand, state.categorySlots)) {
    return false;
  }
  for (const c of state.stock) {
    if (hasValidSlotForCard(c, state.categorySlots)) return false;
  }
  for (const s of state.boardSlots) {
    if (s.cards.length === 0) continue;
    if (!isSlotRevealed(s, state.boardSlots)) continue;
    const chain = getChainEntries(s);
    if (chain.length === 0) continue;
    const chainTop = chain[chain.length - 1].card;
    if (chain.length === 1) {
      if (hasValidSlotForCard(chainTop, state.categorySlots)) return false;
      continue;
    }
    for (const cs of state.categorySlots) {
      if (cs.lockedCategory === null) return false;
      if (chainTop.category === cs.lockedCategory) return false;
    }
  }

  return true;
}

// Reshuffles every card in play: stock, hand (if any), and every card in every
// board stack — including buried ones. Board geometry is preserved: each slot
// keeps its stack height and z-layers; only the card identities at each
// position change.
export function applyShuffle(state: GameState): GameState {
  const pool: Card[] = [];
  if (state.hand) pool.push(state.hand);
  pool.push(...state.stock);
  for (const s of state.boardSlots) {
    for (const entry of s.cards) pool.push(entry.card);
  }

  if (pool.length < 2) return state;

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  let idx = 0;
  const newBoardSlots = state.boardSlots.map((s) => ({
    ...s,
    cards: s.cards.map((entry) => ({ card: pool[idx++], z: entry.z, revealed: entry.revealed })),
  }));

  const newHand: Card | null = state.hand ? pool[idx++] : null;
  const newStock = pool.slice(idx);

  return {
    ...state,
    hand: newHand,
    stock: newStock,
    boardSlots: newBoardSlots,
  };
}
