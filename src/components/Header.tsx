import type { Dispatch } from 'react';
import type { AppAction, GameState, LevelData } from '../types';
import { CardView } from './CardView';
import { setDragSource } from './dragData';
import { hasValidMoveForHandCard } from '../game/moves';

interface Props {
  state: GameState;
  dispatch: Dispatch<AppAction>;
  disabled: boolean;
  highlightUnplayable: boolean;
  onToggleHighlight: () => void;
  levels: LevelData[];
  currentLevelIdx: number;
  onLevelChange: (idx: number) => void;
  canRollback: boolean;
  previewLevelIdx: number | null;
}

export function Header({
  state,
  dispatch,
  disabled,
  highlightUnplayable,
  onToggleHighlight,
  levels,
  currentLevelIdx,
  onLevelChange,
  canRollback,
  previewLevelIdx,
}: Props) {
  const playingPreview = previewLevelIdx !== null && currentLevelIdx === previewLevelIdx;
  const stockEmpty = state.stock.length === 0;
  const handCard = state.hand;

  return (
    <div className="container header">
      <div className="header-controls">
        <select
          className={`level-select${playingPreview ? ' preview' : ''}`}
          value={currentLevelIdx}
          onChange={(e) => onLevelChange(Number(e.target.value))}
        >
          {levels.map((lvl, i) => (
            <option key={`${lvl.levelId}-${i}`} value={i}>
              {previewLevelIdx === i ? `★ Editor preview (${lvl.levelId})` : `Level ${lvl.levelId}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`toggle-btn ${highlightUnplayable ? 'active' : ''}`}
          onClick={onToggleHighlight}
          title="Toggle dimming for cards that have nowhere to go"
        >
          {highlightUnplayable ? '☑' : '☐'} Dim stuck
        </button>
        <button
          className="rollback-btn"
          disabled={!canRollback}
          onClick={() => dispatch({ type: 'ROLLBACK' })}
        >
          ← Undo
        </button>
        <button
          type="button"
          className="shuffle-btn"
          disabled={disabled}
          onClick={() => dispatch({ type: 'SHUFFLE' })}
          title="Reshuffle every card in play (stock, hand, and all board layers)"
        >
          ⇄ Shuffle
        </button>
        <div className="moves-inline" title="Moves used / limit">
          <span className="moves-inline-label">Moves</span>
          <span className="moves-inline-value">
            {state.movesUsed}<span className="moves-sep">/</span>{state.movesLimit}
          </span>
        </div>
        <a
          className={`toggle-btn editor-link${playingPreview ? ' preview' : ''}`}
          href="#/editor"
          title={playingPreview ? 'Back to the editor (this level was generated there)' : 'Open level editor'}
        >
          {playingPreview ? '← Back to editor' : '✏ Editor'}
        </a>
      </div>

      <div className="header-blocks">
        <div className="header-block">
          <div className="header-label">Stock</div>
          <div
            className="stock-pile"
            onClick={() => {
              if (disabled) return;
              if (stockEmpty && !handCard) return;
              dispatch({ type: 'DRAW' });
            }}
            title={stockEmpty ? 'Stock empty' : `${state.stock.length} cards`}
          >
            {!stockEmpty || handCard ? (
              <div className="card face-down stock-back" />
            ) : (
              <div className="card empty-slot">empty</div>
            )}
            {state.stock.length > 0 && <div className="count">{state.stock.length}</div>}
          </div>
        </div>

        <div className="header-block">
          <div className="header-label">Hand</div>
          <div className="hand">
            {handCard ? (() => {
              const stranded = !hasValidMoveForHandCard(handCard, state);
              const dim = stranded && highlightUnplayable;
              return (
                <CardView
                  card={handCard}
                  draggable={!disabled && (!stranded || !highlightUnplayable)}
                  isLocked={dim}
                  onDragStart={(e) => setDragSource(e, { kind: 'hand' })}
                />
              );
            })() : (
              <div className="card empty-slot">empty</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
