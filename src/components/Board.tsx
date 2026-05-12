import type { Dispatch, DragEvent } from 'react';
import { useState, useMemo } from 'react';
import type { AppAction, BoardSlot, GameState } from '../types';
import { CardView } from './CardView';
import { setDragSource, getDragSource } from './dragData';
import { getChainEntries, isEmptyFloorPlaceable, isSlotRevealed, isSlotSideBlocked } from '../game/coverage';
import { hasValidMoveForBoardSlot } from '../game/moves';

const HALF_W = 35;
const HALF_H = 50;
const CARD_W = 70;
const CARD_H = 100;
const LAYER_LIFT = 6;
const STACK_VISUAL_OFFSET_Y = 4;

interface Props {
  state: GameState;
  dispatch: Dispatch<AppAction>;
  disabled: boolean;
  highlightUnplayable: boolean;
}

export function Board({ state, dispatch, disabled, highlightUnplayable }: Props) {
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);

  const { width, height, offsetY } = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    let maxZ = 0;
    let maxStackDepth = 0;
    for (const slot of state.boardSlots) {
      maxX = Math.max(maxX, slot.x);
      maxY = Math.max(maxY, slot.y);
      maxStackDepth = Math.max(maxStackDepth, slot.cards.length);
      for (const c of slot.cards) maxZ = Math.max(maxZ, c.z);
    }
    const lift = maxZ * LAYER_LIFT + Math.max(0, (maxStackDepth - 1)) * STACK_VISUAL_OFFSET_Y + 8;
    const w = maxX * HALF_W + CARD_W;
    const h = lift + maxY * HALF_H + CARD_H + 8;
    return { width: w, height: h, offsetY: lift };
  }, [state.boardSlots]);

  function slotKey(slot: BoardSlot): string {
    return `${slot.x},${slot.y}`;
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, slot: BoardSlot) {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoverSlot(slotKey(slot));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, slot: BoardSlot) {
    if (disabled) return;
    e.preventDefault();
    setHoverSlot(null);
    const src = getDragSource(e);
    if (!src) return;
    if (src.kind === 'board') {
      if (src.x === slot.x && src.y === slot.y) return;
      dispatch({
        type: 'BOARD_TO_BOARD',
        from: { x: src.x, y: src.y },
        to: { x: slot.x, y: slot.y },
      });
    } else if (src.kind === 'hand') {
      dispatch({
        type: 'HAND_TO_BOARD',
        to: { x: slot.x, y: slot.y },
      });
    }
  }

  return (
    <div className="container board-container">
      <div
        className="board-area"
        style={{ width, height }}
      >
        {state.boardSlots.map((slot) => {
          if (slot.cards.length === 0) {
            if (!isEmptyFloorPlaceable(slot, state.boardSlots)) return null;
            const left = slot.x * HALF_W;
            const top = offsetY + slot.y * HALF_H - slot.floorZ * LAYER_LIFT;
            const zIndex = slot.floorZ * 100;
            const isDropTarget = hoverSlot === slotKey(slot);
            return (
              <div
                key={`empty-${slotKey(slot)}`}
                className={`empty-floor-slot${isDropTarget ? ' drop-target' : ''}`}
                style={{ position: 'absolute', left, top, zIndex }}
                onDragOver={(e) => handleDragOver(e, slot)}
                onDragLeave={() => setHoverSlot(null)}
                onDrop={(e) => handleDrop(e, slot)}
              />
            );
          }
          const slotRevealed = isSlotRevealed(slot, state.boardSlots);
          const sideBlocked = slotRevealed && isSlotSideBlocked(slot, state.boardSlots);
          const topIdx = slot.cards.length - 1;
          // Chain = contiguous top suffix sharing categoryId; renders face-up.
          const chainStart = slot.cards.length - getChainEntries(slot).length;
          // Stranded = revealed chain has no valid drag destination.
          const slotStranded =
            slotRevealed && !sideBlocked &&
            !hasValidMoveForBoardSlot(slot, state);
          return slot.cards.map((entry, idx) => {
            const isTop = idx === topIdx;
            const inChain = idx >= chainStart;
            // Face-down when covered from above OR outside the visible chain.
            const faceDown = !(slotRevealed && inChain);
            // Locked appearance: side-blocked OR (stranded AND toggle on).
            const looksLocked =
              isTop && slotRevealed &&
              (sideBlocked || (slotStranded && highlightUnplayable));
            const draggable =
              isTop && slotRevealed && !sideBlocked &&
              (!slotStranded || !highlightUnplayable) && !disabled;
            // Drop targets only need slot to be revealed and not side-blocked;
            // stranded cards can still receive drops from other cards.
            const droppable = isTop && slotRevealed && !sideBlocked;
            const isDropTarget = droppable && hoverSlot === slotKey(slot);

            const stackVisualOffset = idx * STACK_VISUAL_OFFSET_Y;
            const left = slot.x * HALF_W;
            const top =
              offsetY + slot.y * HALF_H - entry.z * LAYER_LIFT - stackVisualOffset;
            const zIndex = entry.z * 100 + idx;

            const handlers: Partial<{
              onDragStart: (e: DragEvent<HTMLDivElement>) => void;
              onDragOver: (e: DragEvent<HTMLDivElement>) => void;
              onDragLeave: () => void;
              onDrop: (e: DragEvent<HTMLDivElement>) => void;
            }> = {};
            if (draggable) {
              handlers.onDragStart = (e) =>
                setDragSource(e, { kind: 'board', x: slot.x, y: slot.y });
            }
            if (droppable) {
              handlers.onDragOver = (e) => handleDragOver(e, slot);
              handlers.onDragLeave = () => setHoverSlot(null);
              handlers.onDrop = (e) => handleDrop(e, slot);
            }

            return (
              <CardView
                key={entry.card.uid}
                card={entry.card}
                faceDown={faceDown}
                draggable={draggable}
                isDropTarget={isDropTarget}
                isLocked={looksLocked}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  zIndex,
                  pointerEvents: droppable ? 'auto' : 'none',
                }}
                {...handlers}
              />
            );
          });
        })}
      </div>
    </div>
  );
}
