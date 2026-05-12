import type { Dispatch, DragEvent } from 'react';
import { useState } from 'react';
import type { AppAction, GameState } from '../types';
import { CardView } from './CardView';
import { getDragSource } from './dragData';
import { countSimpleInCategory } from '../game/cards';

interface Props {
  state: GameState;
  dispatch: Dispatch<AppAction>;
  disabled: boolean;
}

export function CategorySlotsRow({ state, dispatch, disabled }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  function handleDragOver(e: DragEvent<HTMLDivElement>, idx: number) {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHover(idx);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, idx: number) {
    if (disabled) return;
    e.preventDefault();
    setHover(null);
    const src = getDragSource(e);
    if (!src) return;
    if (src.kind === 'hand') {
      dispatch({ type: 'HAND_TO_CATEGORY', slotIndex: idx });
    } else if (src.kind === 'board') {
      dispatch({ type: 'BOARD_TO_CATEGORY', from: { x: src.x, y: src.y }, slotIndex: idx });
    }
  }

  return (
    <div className="container category-slots">
      {state.categorySlots.map((slot, idx) => {
        const isHovered = hover === idx;
        const cls = [
          'category-slot',
          slot.lockedCategory !== null ? 'locked' : '',
          isHovered ? 'drop-target' : '',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={idx}
            className={cls}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragLeave={() => setHover(null)}
            onDrop={(e) => handleDrop(e, idx)}
          >
            {slot.displayedCard ? (
              <CardView
                card={slot.displayedCard}
                counter={
                  slot.displayedCard.isCategory
                    ? { current: 0, total: countSimpleInCategory(state.level, slot.displayedCard.category) }
                    : undefined
                }
              />
            ) : (
              <div className="empty-slot-label">empty</div>
            )}
            {slot.lockedCategory !== null && (
              <div className="progress">
                {slot.cardsConsumed} / {countSimpleInCategory(state.level, slot.lockedCategory)}
              </div>
            )}
          </div>
        );
      })}
      {!state.bonusSlotUsed && (
        <button
          type="button"
          className="category-slot bonus-slot"
          onClick={() => {
            if (disabled) return;
            dispatch({ type: 'ADD_BONUS_SLOT' });
          }}
          title="Add an extra category slot (one-time use)"
        >
          +
        </button>
      )}
    </div>
  );
}
