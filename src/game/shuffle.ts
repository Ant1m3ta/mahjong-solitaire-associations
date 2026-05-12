import type { BoardCardEntry, BoardSlot, Card, CategorySlot, GameState } from '../types';
import { getChainEntries, isEmptyFloorPlaceable, isSlotInteractive } from './coverage';
import { canPlaceInCategorySlot, canPlaceOnBoardCard } from './moves';

function hasValidSlotForCard(card: Card, slots: CategorySlot[]): boolean {
  return slots.some((s) => canPlaceInCategorySlot(card, s));
}

function chainHasValidCategorySlot(
  chain: BoardCardEntry[],
  catSlots: CategorySlot[],
): boolean {
  if (chain.length === 0) return false;
  const chainTop = chain[chain.length - 1].card;
  if (chain.length === 1) {
    return hasValidSlotForCard(chainTop, catSlots);
  }
  for (const s of catSlots) {
    if (s.lockedCategory === null) {
      if (chainTop.isCategory) return true;
      continue;
    }
    if (
      !chainTop.isCategory &&
      chainTop.category === s.lockedCategory &&
      chain.every((e) => !e.card.isCategory)
    ) {
      return true;
    }
  }
  return false;
}

function hashBoardSlots(slots: BoardSlot[]): string {
  return slots
    .map(
      (s) =>
        `${s.x},${s.y},${s.dead ? 1 : 0}:${s.cards
          .map((c) => `${c.card.uid}@${c.z}${c.revealed ? 'R' : ''}`)
          .join(',')}`,
    )
    .join('|');
}

// Simulate a chain move from source to target, mirroring appendChainToSlot's
// re-z + auto-swap rules so the resulting board state matches a real move.
function simulateBoardToBoard(
  slots: BoardSlot[],
  fromIdx: number,
  toIdx: number,
): BoardSlot[] {
  const source = slots[fromIdx];
  const target = slots[toIdx];
  const chain = getChainEntries(source);
  const baseZ = target.cards.length === 0
    ? target.floorZ
    : target.cards[target.cards.length - 1].z + 1;
  const rezed: BoardCardEntry[] = chain.map((e, i) => ({
    card: e.card,
    z: baseZ + i,
    revealed: true,
  }));
  let newTargetCards: BoardCardEntry[];
  if (target.cards.length > 0) {
    const top = target.cards[target.cards.length - 1];
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
      newTargetCards = [...target.cards.slice(0, -1), ...shifted, liftedTop];
    } else {
      newTargetCards = [...target.cards, ...rezed];
    }
  } else {
    newTargetCards = [...rezed];
  }
  return slots.map((s, i) => {
    if (i === fromIdx) {
      const newCards = s.cards.slice(0, s.cards.length - chain.length);
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
    }
    if (i === toIdx) {
      return { ...s, cards: newTargetCards };
    }
    return s;
  });
}

// Deadlock = no sequence of board-to-board rearrangements can reach a state
// where any card (hand, stock, or board chain) is placeable into a category
// slot. Hand/stock placeability is invariant under board-to-board moves, so we
// check those once up front and only BFS over board states.
export function isDeadlocked(state: GameState): boolean {
  if (state.hand && hasValidSlotForCard(state.hand, state.categorySlots)) {
    return false;
  }
  for (const c of state.stock) {
    if (hasValidSlotForCard(c, state.categorySlots)) return false;
  }

  const visited = new Set<string>();
  visited.add(hashBoardSlots(state.boardSlots));
  const queue: BoardSlot[][] = [state.boardSlots];

  while (queue.length > 0) {
    const board = queue.shift()!;

    for (const s of board) {
      if (s.cards.length === 0) continue;
      if (!isSlotInteractive(s, board)) continue;
      const chain = getChainEntries(s);
      if (chainHasValidCategorySlot(chain, state.categorySlots)) return false;
    }

    for (let fromIdx = 0; fromIdx < board.length; fromIdx++) {
      const from = board[fromIdx];
      if (from.cards.length === 0) continue;
      if (!isSlotInteractive(from, board)) continue;
      const fromChain = getChainEntries(from);
      const fromBottom = fromChain[0].card;

      for (let toIdx = 0; toIdx < board.length; toIdx++) {
        if (toIdx === fromIdx) continue;
        const to = board[toIdx];
        if (to.dead) continue;
        if (to.cards.length === 0) {
          if (!isEmptyFloorPlaceable(to, board)) continue;
        } else {
          if (!isSlotInteractive(to, board)) continue;
          const toTop = to.cards[to.cards.length - 1].card;
          if (!canPlaceOnBoardCard(fromBottom, toTop)) continue;
        }

        const next = simulateBoardToBoard(board, fromIdx, toIdx);
        const h = hashBoardSlots(next);
        if (visited.has(h)) continue;
        visited.add(h);
        queue.push(next);
      }
    }
  }

  return true;
}

// Reshuffles every card in play: stock, hand (if any), and every card in every
// board stack — including buried ones. Board geometry is preserved: each slot
// keeps its stack height and z-layers, dead slots stay dead; only the card
// identities at each position change.
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
