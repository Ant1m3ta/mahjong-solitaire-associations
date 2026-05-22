import type { Action, GameState } from '../../types';
import {
  getChainEntries,
  isEmptyFloorPlaceable,
  isSlotRevealed,
} from '../../game/coverage';
import { canPlaceInCategorySlot } from '../../game/moves';

export interface EnumerateOpts {
  disableBoardToBoard?: boolean;
  drawOnlyWhenHandEmpty?: boolean;
}

// Move-ordering: board-removing actions first so that with equal f-scores the
// search finds "clear board first" solutions before stock-stash ones.
export function enumerateMoves(state: GameState, opts: EnumerateOpts = {}): Action[] {
  const moves: Action[] = [];

  for (const src of state.boardSlots) {
    if (!isSlotRevealed(src, state.boardSlots)) continue;
    const chain = getChainEntries(src);
    if (chain.length === 0) continue;
    const chainTop = chain[chain.length - 1].card;

    let emptyCatPushed = false;
    for (let i = 0; i < state.categorySlots.length; i++) {
      const cs = state.categorySlots[i];
      if (cs.lockedCategory === null) {
        if (emptyCatPushed) continue;
        if (chain.length === 1 && !canPlaceInCategorySlot(chainTop, cs)) continue;
        if (chain.length > 1 && !chain.some((e) => e.card.isCategory)) continue;
        emptyCatPushed = true;
        moves.push({
          type: 'BOARD_TO_CATEGORY',
          from: { x: src.x, y: src.y },
          slotIndex: i,
        });
        continue;
      }
      if (chain.length === 1) {
        if (canPlaceInCategorySlot(chainTop, cs)) {
          moves.push({
            type: 'BOARD_TO_CATEGORY',
            from: { x: src.x, y: src.y },
            slotIndex: i,
          });
        }
      } else if (chainTop.category === cs.lockedCategory) {
        moves.push({
          type: 'BOARD_TO_CATEGORY',
          from: { x: src.x, y: src.y },
          slotIndex: i,
        });
      }
    }
  }

  if (state.hand !== null) {
    const hand = state.hand;
    let emptyCatPushed = false;
    for (let i = 0; i < state.categorySlots.length; i++) {
      const slot = state.categorySlots[i];
      if (slot.lockedCategory === null) {
        if (emptyCatPushed) continue;
        if (!canPlaceInCategorySlot(hand, slot)) continue;
        emptyCatPushed = true;
        moves.push({ type: 'HAND_TO_CATEGORY', slotIndex: i });
      } else if (canPlaceInCategorySlot(hand, slot)) {
        moves.push({ type: 'HAND_TO_CATEGORY', slotIndex: i });
      }
    }
  }

  if (state.hand !== null) {
    for (const slot of state.boardSlots) {
      if (slot.cards.length !== 0) continue;
      if (!isEmptyFloorPlaceable(slot, state.boardSlots)) continue;
      moves.push({ type: 'HAND_TO_BOARD', to: { x: slot.x, y: slot.y } });
    }
  }

  if (state.stock.length > 0) {
    if (!opts.drawOnlyWhenHandEmpty || state.hand === null) {
      moves.push({ type: 'DRAW' });
    }
  }

  if (!opts.disableBoardToBoard) {
    for (const src of state.boardSlots) {
      if (!isSlotRevealed(src, state.boardSlots)) continue;
      const chain = getChainEntries(src);
      if (chain.length === 0) continue;
      for (const tgt of state.boardSlots) {
        if (tgt === src) continue;
        if (tgt.cards.length !== 0) continue;
        if (!isEmptyFloorPlaceable(tgt, state.boardSlots)) continue;
        moves.push({
          type: 'BOARD_TO_BOARD',
          from: { x: src.x, y: src.y },
          to: { x: tgt.x, y: tgt.y },
        });
      }
    }
  }

  return moves;
}
