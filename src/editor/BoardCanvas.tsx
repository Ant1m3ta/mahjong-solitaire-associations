import { useMemo, useState, type Dispatch, type MouseEvent } from 'react';
import type { EditorAction, EditorState, SkeletonBoardCard } from './types';

const HALF_W = 35;
const HALF_H = 50;
const CARD_W = 70;
const CARD_H = 100;
const LAYER_LIFT = 6;
const GRID_PAD = 4;
const MIN_GRID_W = 20;
const MIN_GRID_H = 16;

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

interface HoverCell {
  x: number;
  y: number;
}

export function BoardCanvas({ state, dispatch }: Props) {
  const [hover, setHover] = useState<HoverCell | null>(null);
  const { brush, eraseMode, currentLayer, level, ghostBelow, ghostAbove } = state;

  const { gridW, gridH, maxZ } = useMemo(() => {
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const c of level.board) {
      if (c.x > mx) mx = c.x;
      if (c.y > my) my = c.y;
      if (c.z > mz) mz = c.z;
    }
    return {
      gridW: Math.max(MIN_GRID_W, mx + GRID_PAD),
      gridH: Math.max(MIN_GRID_H, my + GRID_PAD),
      maxZ: Math.max(mz, currentLayer),
    };
  }, [level.board, currentLayer]);

  const offsetY = maxZ * LAYER_LIFT + 8;
  const areaW = gridW * HALF_W + CARD_W;
  const areaH = offsetY + gridH * HALF_H + CARD_H + 8;

  function cellFromEvent(e: MouseEvent<HTMLDivElement>): HoverCell | null {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const relY = py - offsetY + currentLayer * LAYER_LIFT;
    if (px < 0 || relY < 0) return null;
    const x = Math.floor(px / HALF_W);
    const y = Math.floor(relY / HALF_H);
    if (x < 0 || y < 0 || x > gridW || y > gridH) return null;
    return { x, y };
  }

  function findCardAtFootprint(cx: number, cy: number, z: number): SkeletonBoardCard | null {
    let best: SkeletonBoardCard | null = null;
    for (const c of level.board) {
      if (c.z !== z) continue;
      if (cx >= c.x && cx <= c.x + 1 && cy >= c.y && cy <= c.y + 1) {
        if (!best) best = c;
      }
    }
    return best;
  }

  function findCardAtAnchor(cx: number, cy: number, z: number): SkeletonBoardCard | null {
    return level.board.find((c) => c.x === cx && c.y === cy && c.z === z) ?? null;
  }

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const { x, y } = cell;
    if (eraseMode) {
      const card = findCardAtFootprint(x, y, currentLayer);
      if (card) dispatch({ type: 'REMOVE_BOARD', x: card.x, y: card.y, z: card.z });
      return;
    }
    if (!brush.letter) return;
    if (findCardAtAnchor(x, y, currentLayer)) return;
    dispatch({
      type: 'PLACE_BOARD',
      x,
      y,
      z: currentLayer,
      letter: brush.letter,
      cardKind: brush.kind,
    });
  }

  function handleMove(e: MouseEvent<HTMLDivElement>) {
    setHover(cellFromEvent(e));
  }

  const hoverErase =
    hover && eraseMode ? findCardAtFootprint(hover.x, hover.y, currentLayer) : null;

  return (
    <div className="editor-canvas">
      <div
        className="editor-board-area"
        style={{ width: areaW, height: areaH }}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <CurrentLayerGrid
          gridW={gridW}
          gridH={gridH}
          offsetY={offsetY}
          currentLayer={currentLayer}
        />

        {level.board.map((card) => {
          const isCurrent = card.z === currentLayer;
          const isBelow = card.z < currentLayer;
          const isAbove = card.z > currentLayer;
          if (isBelow && !ghostBelow) return null;
          if (isAbove && !ghostAbove) return null;
          const left = card.x * HALF_W;
          const top = offsetY + card.y * HALF_H - card.z * LAYER_LIFT;
          const zIndex = card.z * 100 + (isCurrent ? 50 : 0);
          const cls = [
            'editor-card',
            card.kind === 'category' ? 'category' : 'simple',
            isBelow ? 'ghost-below' : '',
            isAbove ? 'ghost-above' : '',
            !isCurrent ? 'non-current' : '',
            hoverErase && hoverErase === card ? 'erase-target' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={`${card.x},${card.y},${card.z}`}
              className={cls}
              style={{ left, top, zIndex }}
            >
              <span className="editor-card-letter">
                {card.kind === 'category' ? card.letter : card.letter.toLowerCase()}
              </span>
            </div>
          );
        })}

        {hover && !eraseMode && brush.letter && !findCardAtAnchor(hover.x, hover.y, currentLayer) && (
          <div
            className="editor-card hover-preview"
            style={{
              left: hover.x * HALF_W,
              top: offsetY + hover.y * HALF_H - currentLayer * LAYER_LIFT,
              zIndex: currentLayer * 100 + 99,
            }}
          >
            <span className="editor-card-letter">
              {brush.kind === 'category' ? brush.letter : brush.letter.toLowerCase()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function CurrentLayerGrid({
  gridW,
  gridH,
  offsetY,
  currentLayer,
}: {
  gridW: number;
  gridH: number;
  offsetY: number;
  currentLayer: number;
}) {
  const left = 0;
  const top = offsetY - currentLayer * LAYER_LIFT;
  const w = gridW * HALF_W + CARD_W;
  const h = gridH * HALF_H + CARD_H;
  return (
    <div
      className="editor-grid-overlay"
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        backgroundImage:
          'linear-gradient(to right, rgba(102,204,255,0.06) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(102,204,255,0.06) 1px, transparent 1px)',
        backgroundSize: `${HALF_W}px ${HALF_H}px`,
        pointerEvents: 'none',
        zIndex: currentLayer * 100 - 1,
      }}
    />
  );
}
