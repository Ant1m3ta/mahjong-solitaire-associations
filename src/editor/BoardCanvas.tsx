import { useMemo, useState, type Dispatch, type MouseEvent } from 'react';
import type { AlignAnchor, EditorAction, EditorState, SkeletonBoardCard } from './types';
import { LAYER_LIFT } from '../layout';
import { isSlotRevealed } from '../game/coverage';

const HALF_W = 35;
const HALF_H = 50;
const CARD_W = 70;
const CARD_H = 100;
const GRID_PAD = 4;
const MIN_GRID_W = 20;
const MIN_GRID_H = 16;
const Z_BASE = 10000;
// Authoring guide: a square playfield this many full cards wide and tall.
const OUTLINE_CARDS = 5;

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  moveIndexByCellKey?: Map<string, number>;
}

interface HoverCell {
  x: number;
  y: number;
}

export function BoardCanvas({ state, dispatch, moveIndexByCellKey }: Props) {
  const [hover, setHover] = useState<HoverCell | null>(null);
  const { brush, eraseMode, moveMode, swapMode, pickedCard, currentLayer, level, ghostBelow, revealPreview, gridOutline } = state;

  // Cells that would be face-up in the real game: the top of each (x, y) stack
  // whose slot is uncovered per the shared `isSlotRevealed` rule. Reveal there
  // ignores `currentLayer` entirely, so many z-layers can be revealed at once —
  // the layer view dims by z and so blanks cards that actually play face-up.
  const revealedKeys = useMemo(() => {
    const slots = new Map<string, { x: number; y: number; cards: SkeletonBoardCard[] }>();
    for (const c of level.board) {
      const key = `${c.x},${c.y}`;
      let s = slots.get(key);
      if (!s) {
        s = { x: c.x, y: c.y, cards: [] };
        slots.set(key, s);
      }
      s.cards.push(c);
    }
    const all = Array.from(slots.values());
    for (const s of all) s.cards.sort((a, b) => a.z - b.z);
    const keys = new Set<string>();
    for (const s of all) {
      if (!isSlotRevealed(s, all)) continue;
      const top = s.cards[s.cards.length - 1];
      keys.add(`${top.x},${top.y},${top.z}`);
    }
    return keys;
  }, [level.board]);

  // Per-category card counts on the layer currently being edited. Each board
  // card references its category by `letter`, so we group by it and split out
  // category (lock) cards from simple cards.
  const layerCounts = useMemo(() => {
    const m = new Map<string, { simple: number; category: number }>();
    for (const c of level.board) {
      if (c.z !== currentLayer) continue;
      let e = m.get(c.letter);
      if (!e) {
        e = { simple: 0, category: 0 };
        m.set(c.letter, e);
      }
      if (c.kind === 'category') e.category++;
      else e.simple++;
    }
    return Array.from(m.entries())
      .map(([letter, v]) => ({ letter, simple: v.simple, category: v.category, total: v.simple + v.category }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
  }, [level.board, currentLayer]);
  const layerTotal = layerCounts.reduce((s, r) => s + r.total, 0);

  const { gridW, gridH, maxZ, minZ } = useMemo(() => {
    let mx = 0;
    let my = 0;
    let hiZ = -Infinity;
    let loZ = Infinity;
    for (const c of level.board) {
      if (c.x > mx) mx = c.x;
      if (c.y > my) my = c.y;
      if (c.z > hiZ) hiZ = c.z;
      if (c.z < loZ) loZ = c.z;
    }
    if (!isFinite(hiZ)) hiZ = currentLayer;
    if (!isFinite(loZ)) loZ = currentLayer;
    return {
      gridW: Math.max(MIN_GRID_W, mx + GRID_PAD),
      gridH: Math.max(MIN_GRID_H, my + GRID_PAD),
      maxZ: Math.max(hiZ, currentLayer),
      minZ: Math.min(loZ, currentLayer),
    };
  }, [level.board, currentLayer]);

  const offsetY = maxZ * LAYER_LIFT + 8;
  const areaW = gridW * HALF_W + CARD_W;
  const areaH = offsetY + gridH * HALF_H + CARD_H + 8 + Math.max(0, -minZ) * LAYER_LIFT;

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

  function footprintOccupiedAt(
    cx: number,
    cy: number,
    z: number,
    exclude: { x: number; y: number; z: number } | null,
  ): boolean {
    for (const c of level.board) {
      if (c.z !== z) continue;
      if (exclude && c.x === exclude.x && c.y === exclude.y && c.z === exclude.z) continue;
      if (Math.abs(c.x - cx) <= 1 && Math.abs(c.y - cy) <= 1) return true;
    }
    return false;
  }

  function targetZFor(cx: number, cy: number, exclude: { x: number; y: number; z: number } | null = null): number {
    // Start at the user's chosen layer; bump up only while a card at this
    // footprint at the same z is in the way. Higher half-offset cards at z>cur
    // do not push us up — they sit above the new card.
    let z = currentLayer;
    while (footprintOccupiedAt(cx, cy, z, exclude)) z++;
    return z;
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
    if (swapMode) {
      const card = findCardAtFootprint(x, y, currentLayer);
      if (card) dispatch({ type: 'SWAP_LOCK', target: { where: 'board', x: card.x, y: card.y, z: card.z } });
      return;
    }
    if (moveMode) {
      if (!pickedCard) {
        const card = findCardAtFootprint(x, y, currentLayer);
        if (card) dispatch({ type: 'PICK_CARD', x: card.x, y: card.y, z: card.z });
        return;
      }
      if (x === pickedCard.x && y === pickedCard.y) {
        dispatch({ type: 'CANCEL_PICK' });
        return;
      }
      const z = targetZFor(x, y, pickedCard);
      dispatch({ type: 'MOVE_BOARD', from: pickedCard, to: { x, y, z } });
      return;
    }
    if (!brush.letter) return;
    const z = targetZFor(x, y);
    dispatch({
      type: 'PLACE_BOARD',
      x,
      y,
      z,
      letter: brush.letter,
      cardKind: brush.kind,
    });
  }

  function handleMove(e: MouseEvent<HTMLDivElement>) {
    setHover(cellFromEvent(e));
  }

  const hoverErase =
    hover && eraseMode ? findCardAtFootprint(hover.x, hover.y, currentLayer) : null;
  const hoverSwap =
    hover && swapMode ? findCardAtFootprint(hover.x, hover.y, currentLayer) : null;
  const hoverPick =
    hover && moveMode && !pickedCard ? findCardAtFootprint(hover.x, hover.y, currentLayer) : null;
  const pickedBoardCard = pickedCard
    ? level.board.find((c) => c.x === pickedCard.x && c.y === pickedCard.y && c.z === pickedCard.z) ?? null
    : null;

  return (
    <div className="editor-canvas-wrap">
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

        {gridOutline && (
          <PlayfieldOutline offsetY={offsetY} currentLayer={currentLayer} />
        )}

        {level.board.map((card) => {
          const cellKey = `${card.x},${card.y},${card.z}`;
          const moveIdx = moveIndexByCellKey?.get(cellKey);

          // Reveal preview: show every card, face-up if uncovered in-game,
          // face-down if covered — independent of the current layer.
          if (revealPreview) {
            const left = card.x * HALF_W;
            const top = offsetY + card.y * HALF_H - card.z * LAYER_LIFT;
            const zIndex = Z_BASE + card.z * 100;
            const cls = [
              'editor-card',
              card.kind === 'category' ? 'category' : 'simple',
              revealedKeys.has(cellKey) ? 'reveal-up' : 'covered-preview',
            ].join(' ');
            return (
              <div key={cellKey} className={cls} style={{ left, top, zIndex }}>
                <span className="editor-card-letter">
                  {card.kind === 'category' ? card.letter : card.letter.toLowerCase()}
                </span>
                {moveIdx !== undefined && (
                  <span className="editor-card-move-badge" title={`Played on move ${moveIdx}`}>
                    {moveIdx}
                  </span>
                )}
              </div>
            );
          }

          const isCurrent = card.z === currentLayer;
          const isBelow = card.z < currentLayer;
          if (card.z > currentLayer) return null;
          if (isBelow && !ghostBelow) return null;
          const left = card.x * HALF_W;
          const top = offsetY + card.y * HALF_H - card.z * LAYER_LIFT;
          const zIndex = Z_BASE + card.z * 100 + (isCurrent ? 50 : 0);
          const isPicked = pickedBoardCard === card;
          const cls = [
            'editor-card',
            card.kind === 'category' ? 'category' : 'simple',
            isBelow ? 'ghost-below' : '',
            !isCurrent ? 'non-current' : '',
            hoverErase && hoverErase === card ? 'erase-target' : '',
            hoverSwap && hoverSwap === card ? 'swap-target' : '',
            hoverPick && hoverPick === card ? 'pick-target' : '',
            isPicked ? 'picked' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={cellKey}
              className={cls}
              style={{ left, top, zIndex }}
            >
              <span className="editor-card-letter">
                {card.kind === 'category' ? card.letter : card.letter.toLowerCase()}
              </span>
              {moveIdx !== undefined && (
                <span className="editor-card-move-badge" title={`Played on move ${moveIdx}`}>
                  {moveIdx}
                </span>
              )}
            </div>
          );
        })}

        {hover && !eraseMode && !moveMode && brush.letter && (() => {
          const previewZ = targetZFor(hover.x, hover.y);
          return (
            <div
              className="editor-card hover-preview"
              style={{
                left: hover.x * HALF_W,
                top: offsetY + hover.y * HALF_H - previewZ * LAYER_LIFT,
                zIndex: Z_BASE + previewZ * 100 + 99,
              }}
            >
              <span className="editor-card-letter">
                {brush.kind === 'category' ? brush.letter : brush.letter.toLowerCase()}
              </span>
            </div>
          );
        })()}
        {hover && moveMode && pickedCard && pickedBoardCard && (() => {
          const sameAnchor = hover.x === pickedCard.x && hover.y === pickedCard.y;
          if (sameAnchor) return null;
          const previewZ = targetZFor(hover.x, hover.y, pickedCard);
          return (
            <div
              className={`editor-card hover-preview ${pickedBoardCard.kind === 'category' ? 'category' : 'simple'}`}
              style={{
                left: hover.x * HALF_W,
                top: offsetY + hover.y * HALF_H - previewZ * LAYER_LIFT,
                zIndex: Z_BASE + previewZ * 100 + 99,
              }}
            >
              <span className="editor-card-letter">
                {pickedBoardCard.kind === 'category'
                  ? pickedBoardCard.letter
                  : pickedBoardCard.letter.toLowerCase()}
              </span>
            </div>
          );
        })()}
      </div>
      </div>

      <div className="layer-overlay">
        <aside className="layer-counts">
          <div className="layer-counts-head">
            <span>Layer z={currentLayer}</span>
            <span className="layer-counts-total">
              {layerTotal} {layerTotal === 1 ? 'card' : 'cards'}
            </span>
          </div>
          {layerCounts.length === 0 ? (
            <div className="layer-counts-empty">No cards on this layer.</div>
          ) : (
            <ul className="layer-counts-list">
              {layerCounts.map((r) => (
                <li key={r.letter} className="layer-counts-row">
                  <span className="layer-counts-chip">{r.letter}</span>
                  <span className="layer-counts-n">{r.total}</span>
                  {r.category > 0 && (
                    <span
                      className="layer-counts-cat"
                      title={`${r.category} category card${r.category > 1 ? 's' : ''} on this layer`}
                    >
                      {r.category} cat
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
        <AlignGrid disabled={level.board.length === 0} dispatch={dispatch} />
      </div>
    </div>
  );
}

// 3×3 anchor picker: each icon button snaps the whole board to a corner / edge /
// center of the 5×5 outline (fires ALIGN_BOARD). Arrows point toward the anchor.
const ALIGN_BUTTONS: { icon: string; ax: AlignAnchor; ay: AlignAnchor; title: string }[] = [
  { icon: '↖', ax: 'start', ay: 'start', title: 'Top-left' },
  { icon: '↑', ax: 'center', ay: 'start', title: 'Top' },
  { icon: '↗', ax: 'end', ay: 'start', title: 'Top-right' },
  { icon: '←', ax: 'start', ay: 'center', title: 'Left' },
  { icon: '⊙', ax: 'center', ay: 'center', title: 'Center' },
  { icon: '→', ax: 'end', ay: 'center', title: 'Right' },
  { icon: '↙', ax: 'start', ay: 'end', title: 'Bottom-left' },
  { icon: '↓', ax: 'center', ay: 'end', title: 'Bottom' },
  { icon: '↘', ax: 'end', ay: 'end', title: 'Bottom-right' },
];

function AlignGrid({
  disabled,
  dispatch,
}: {
  disabled: boolean;
  dispatch: Dispatch<EditorAction>;
}) {
  return (
    <div
      className="align-grid"
      title="Snap the whole board to a corner / side / center of the 5×5 outline"
    >
      {ALIGN_BUTTONS.map((b) => (
        <button
          key={`${b.ax}-${b.ay}`}
          className="align-btn"
          disabled={disabled}
          title={`Align ${b.title.toLowerCase()}`}
          onClick={() => dispatch({ type: 'ALIGN_BOARD', anchorX: b.ax, anchorY: b.ay })}
        >
          {b.icon}
        </button>
      ))}
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
        zIndex: Z_BASE + currentLayer * 100 - 1,
      }}
    />
  );
}

// A bold OUTLINE_CARDS×OUTLINE_CARDS card playfield guide, anchored at the
// origin and following the current layer's vertical lift like the half-cell
// grid. Inner lines fall on full-card boundaries (every CARD_W / CARD_H).
function PlayfieldOutline({ offsetY, currentLayer }: { offsetY: number; currentLayer: number }) {
  const top = offsetY - currentLayer * LAYER_LIFT;
  const w = OUTLINE_CARDS * CARD_W;
  const h = OUTLINE_CARDS * CARD_H;
  return (
    <div
      className="editor-playfield-outline"
      style={{
        position: 'absolute',
        left: 0,
        top,
        width: w,
        height: h,
        border: '2px solid rgba(255,196,80,0.55)',
        boxSizing: 'border-box',
        backgroundImage:
          'linear-gradient(to right, rgba(255,196,80,0.18) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(255,196,80,0.18) 1px, transparent 1px)',
        backgroundSize: `${CARD_W}px ${CARD_H}px`,
        pointerEvents: 'none',
        zIndex: Z_BASE + currentLayer * 100 - 1,
      }}
    />
  );
}
