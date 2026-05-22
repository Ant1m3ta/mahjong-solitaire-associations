import type { CSSProperties, DragEvent, ReactNode } from 'react';
import type { Card } from '../types';

// Auto-size the card label by character count. Anchored so a single letter
// renders at 24px (2× the base .card font-size of 12px), then steps down 2px
// per extra character and clamps at the base 12px for 7+ chars.
function labelFontSizePx(len: number): number {
  return Math.max(12, 24 - 2 * Math.max(0, len - 1));
}

interface Props {
  card: Card | null;
  faceDown?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  isLocked?: boolean;
  counter?: { current: number; total: number };
  className?: string;
  style?: CSSProperties;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

export function CardView({
  card,
  faceDown,
  draggable,
  isDragging,
  isDropTarget,
  isLocked,
  counter,
  className = '',
  style,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: Props) {
  const classes = [
    'card',
    card?.isCategory ? 'category' : '',
    faceDown ? 'face-down' : '',
    draggable ? 'draggable' : '',
    isDragging ? 'dragging' : '',
    isDropTarget ? 'drop-target' : '',
    isLocked ? 'side-blocked' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      draggable={draggable ?? false}
      style={style}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {!faceDown && card && card.isIcon && card.imageId ? (
        <img
          className="card-image"
          src={`${import.meta.env.BASE_URL}images/${card.imageId}.png`}
          alt={card.word}
          draggable={false}
        />
      ) : null}
      {!faceDown && card && !card.isIcon && (
        <span
          className="card-label"
          style={{ fontSize: `${labelFontSizePx(card.word.length)}px` }}
        >
          {card.word}
        </span>
      )}
      {!faceDown && counter && (
        <span className="card-counter">
          {counter.current}/{counter.total}
        </span>
      )}
      {children}
    </div>
  );
}
