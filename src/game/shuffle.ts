import type { BoardSlot, Card, CategorySlot, GameState } from '../types';
import { isSlotInteractive, isSlotRevealed } from './coverage';
import { canPlaceInCategorySlot, canPlaceOnBoardCard } from './moves';

function hasValidSlotForCard(card: Card, slots: CategorySlot[]): boolean {
  return slots.some((s) => canPlaceInCategorySlot(card, s));
}

function hashBoardSlots(slots: BoardSlot[]): string {
  return slots
    .map(
      (s) =>
        `${s.x},${s.y},${s.dead ? 1 : 0}:${s.cards
          .map((c) => `${c.card.uid}@${c.z}`)
          .join(',')}`,
    )
    .join('|');
}

function simulateBoardToBoard(
  slots: BoardSlot[],
  fromIdx: number,
  toIdx: number,
): BoardSlot[] {
  const sourceTop = slots[fromIdx].cards[slots[fromIdx].cards.length - 1];
  const targetTop = slots[toIdx].cards[slots[toIdx].cards.length - 1];
  return slots.map((s, i) => {
    if (i === fromIdx) {
      const newCards = s.cards.slice(0, -1);
      return {
        ...s,
        cards: newCards,
        dead: newCards.length === 0 ? true : s.dead,
      };
    }
    if (i === toIdx) {
      return {
        ...s,
        cards: [...s.cards, { card: sourceTop.card, z: targetTop.z + 1 }],
      };
    }
    return s;
  });
}

// Deadlock = no sequence of board-to-board rearrangements can reach a state
// where any card (hand, stock, or board top) is placeable into a category slot.
// Hand/stock placeability is invariant under board-to-board moves, so we check
// those once up front and only BFS over board states.
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
      const top = s.cards[s.cards.length - 1].card;
      if (hasValidSlotForCard(top, state.categorySlots)) return false;
    }

    for (let fromIdx = 0; fromIdx < board.length; fromIdx++) {
      const from = board[fromIdx];
      if (from.cards.length === 0) continue;
      if (!isSlotInteractive(from, board)) continue;
      const fromTop = from.cards[from.cards.length - 1].card;

      for (let toIdx = 0; toIdx < board.length; toIdx++) {
        if (toIdx === fromIdx) continue;
        const to = board[toIdx];
        if (to.cards.length === 0 || to.dead) continue;
        if (!isSlotInteractive(to, board)) continue;
        const toTop = to.cards[to.cards.length - 1].card;
        if (!canPlaceOnBoardCard(fromTop, toTop)) continue;

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

// Reshuffles all face-up cards: stock, hand (if any), and the top card of every
// revealed slot (whether side-blocked or not). Stack heights and z-layers are
// preserved — only top-of-stack identities change.
export function applyShuffle(state: GameState): GameState {
  const pool: Card[] = [];
  if (state.hand) pool.push(state.hand);
  pool.push(...state.stock);

  const revealedIndices: number[] = [];
  for (let i = 0; i < state.boardSlots.length; i++) {
    const s = state.boardSlots[i];
    if (s.cards.length === 0) continue;
    if (!isSlotRevealed(s, state.boardSlots)) continue;
    pool.push(s.cards[s.cards.length - 1].card);
    revealedIndices.push(i);
  }

  if (pool.length < 2) return state;

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  let idx = 0;
  const revealedSet = new Set(revealedIndices);
  const newBoardSlots = state.boardSlots.map((s, i) => {
    if (!revealedSet.has(i)) return s;
    const oldTop = s.cards[s.cards.length - 1];
    const newCards = [
      ...s.cards.slice(0, -1),
      { card: pool[idx++], z: oldTop.z },
    ];
    return { ...s, cards: newCards };
  });

  const newHand: Card | null = state.hand ? pool[idx++] : null;
  const newStock = pool.slice(idx);

  return {
    ...state,
    hand: newHand,
    stock: newStock,
    boardSlots: newBoardSlots,
  };
}
