import { useReducer, useEffect, useState, useMemo } from 'react';
import { initialEditorState, normalizeLevel, reduceEditor } from './reducer';
import { CategoriesRail } from './CategoriesRail';
import { BoardCanvas } from './BoardCanvas';
import { fillSkeleton, FillError } from './fill';
import { downloadLevelJSON, storePreviewAndPlay } from './save';
import { validate } from './validate';

export function Editor() {
  const [state, dispatch] = useReducer(reduceEditor, undefined, initialEditorState);
  const [fillError, setFillError] = useState<string | null>(null);
  const brush = state.brush;
  const brushCat = brush.letter
    ? state.level.categories.find((c) => c.letter === brush.letter) ?? null
    : null;

  function handleSave() {
    try {
      const { level: normalized } = normalizeLevel(state.level);
      const filled = fillSkeleton(normalized);
      downloadLevelJSON(filled, `${state.level.levelId || 'level'}.json`);
      setFillError(null);
    } catch (e) {
      const msg = e instanceof FillError ? e.message : String(e);
      setFillError(msg);
    }
  }

  function handlePlay() {
    try {
      const { level: normalized } = normalizeLevel(state.level);
      const filled = fillSkeleton(normalized);
      storePreviewAndPlay(filled);
      setFillError(null);
    } catch (e) {
      const msg = e instanceof FillError ? e.message : String(e);
      setFillError(msg);
    }
  }

  const saveDisabled = state.level.categories.length === 0 || state.level.board.length === 0;
  const validation = useMemo(() => validate(state.level), [state.level]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inEditable = target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        dispatch({ type: 'ROLLBACK' });
        return;
      }
      if (inEditable) return;
      if (e.key === '[' || e.key === 'ArrowDown') {
        e.preventDefault();
        dispatch({ type: 'SET_LAYER', z: state.currentLayer - 1 });
      } else if (e.key === ']' || e.key === 'ArrowUp') {
        e.preventDefault();
        dispatch({ type: 'SET_LAYER', z: state.currentLayer + 1 });
      } else if (e.key === 'e' || e.key === 'E') {
        dispatch({ type: 'TOGGLE_ERASE' });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        dispatch({
          type: 'SET_BRUSH_KIND',
          kind: state.brush.kind === 'simple' ? 'category' : 'simple',
        });
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const cat = state.level.categories[idx];
        if (cat) dispatch({ type: 'SET_BRUSH_LETTER', letter: cat.letter });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.currentLayer, state.brush.kind, state.level.categories]);

  return (
    <div className="editor">
      <div className="editor-topbar">
        <a className="editor-back" href="#/">← Game</a>
        <h1 className="editor-title">Level Editor</h1>
        <div className="editor-meta">
          <label>
            id
            <input
              className="editor-input"
              value={state.level.levelId}
              onChange={(e) => dispatch({ type: 'SET_LEVEL_ID', id: e.target.value })}
            />
          </label>
          <label>
            slots
            <input
              className="editor-input small"
              type="number"
              min={1}
              max={6}
              value={state.level.slotsDefault}
              onChange={(e) => dispatch({ type: 'SET_SLOTS', slots: Number(e.target.value) })}
            />
          </label>
          <label>
            moves
            <input
              className="editor-input small"
              type="number"
              min={-1}
              value={state.level.movesLimit}
              onChange={(e) => dispatch({ type: 'SET_MOVES', moves: Number(e.target.value) })}
              disabled={state.level.movesLimit < 0}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.level.movesLimit < 0}
              onChange={(e) =>
                dispatch({ type: 'SET_MOVES', moves: e.target.checked ? -1 : 100 })
              }
            />
            unlimited
          </label>
        </div>
        <div className="editor-actions">
          <button
            className="editor-btn"
            disabled={state.history.length === 0}
            onClick={() => dispatch({ type: 'ROLLBACK' })}
            title="Undo last edit (⌘Z)"
          >
            ← Undo {state.history.length > 0 ? `(${state.history.length})` : ''}
          </button>
          <button
            className="editor-btn"
            disabled={state.level.board.length === 0}
            onClick={() => dispatch({ type: 'NORMALIZE_LAYERS' })}
            title="Shift all cards so the lowest z = 0 (so the bottom-floor rule applies)"
          >
            Normalize
          </button>
          <button className="editor-btn" disabled={saveDisabled} onClick={handleSave}>
            Save .json
          </button>
          <button className="editor-btn primary" disabled={saveDisabled} onClick={handlePlay}>
            Play
          </button>
        </div>
      </div>

      <div className="editor-body">
        <CategoriesRail state={state} dispatch={dispatch} />

        <main className="editor-main">
          <div className="editor-canvas-controls">
            <div className="layer-control">
              <button
                className="editor-btn small"
                onClick={() => dispatch({ type: 'SET_LAYER', z: state.currentLayer + 1 })}
                title="Go up a layer (↑ or ])"
              >
                ▲
              </button>
              <span className="layer-label">z = {state.currentLayer}</span>
              <button
                className="editor-btn small"
                onClick={() => dispatch({ type: 'SET_LAYER', z: state.currentLayer - 1 })}
                title="Go down a layer (↓ or [). Negative z is fine; Normalize before save."
              >
                ▼
              </button>
            </div>
            <div className="brush-control">
              <span className="brush-label">Brush:</span>
              {state.eraseMode ? (
                <span className="brush-current erase">Erase</span>
              ) : brushCat ? (
                <>
                  <span className="brush-current">
                    <span className="brush-letter">{brush.letter}</span>
                    <span className="brush-kind">·</span>
                    <span className="brush-kind">{brush.kind}</span>
                  </span>
                  <button
                    className="editor-btn small"
                    onClick={() =>
                      dispatch({
                        type: 'SET_BRUSH_KIND',
                        kind: brush.kind === 'simple' ? 'category' : 'simple',
                      })
                    }
                    title="Toggle simple ↔ category (Tab)"
                  >
                    ⇄
                  </button>
                </>
              ) : (
                <span className="brush-empty">— no category selected —</span>
              )}
              <button
                className={`editor-btn small${state.eraseMode ? ' active' : ''}`}
                onClick={() => dispatch({ type: 'TOGGLE_ERASE' })}
                title="Erase mode (E)"
              >
                Erase
              </button>
            </div>
            <div className="ghost-toggles">
              <label title="Show cards on lower layers as ghosts">
                <input
                  type="checkbox"
                  checked={state.ghostBelow}
                  onChange={() => dispatch({ type: 'TOGGLE_GHOST_BELOW' })}
                />
                ghost z&lt;{state.currentLayer}
              </label>
              <label title="Show cards on upper layers as ghosts">
                <input
                  type="checkbox"
                  checked={state.ghostAbove}
                  onChange={() => dispatch({ type: 'TOGGLE_GHOST_ABOVE' })}
                />
                ghost z&gt;{state.currentLayer}
              </label>
            </div>
          </div>
          <BoardCanvas state={state} dispatch={dispatch} />
          <div className="editor-stock">
            <div className="editor-stock-title">
              Stock <span className="dim">({state.level.stock.length} cards, first drawn →)</span>
            </div>
            <div className="editor-stock-strip">
              {state.level.stock.length === 0 ? (
                <div className="editor-empty">Empty.</div>
              ) : (
                state.level.stock.map((entry, i) => (
                  <div key={i} className={`stock-chip kind-${entry.kind}`}>
                    <div className="stock-chip-card">
                      <span>{entry.kind === 'category' ? entry.letter : entry.letter.toLowerCase()}</span>
                    </div>
                    <div className="stock-chip-controls">
                      <button
                        className="editor-btn small"
                        onClick={() => dispatch({ type: 'REORDER_STOCK', from: i, to: i - 1 })}
                        disabled={i === 0}
                        title="Move earlier"
                      >
                        ◂
                      </button>
                      <button
                        className="editor-btn small"
                        onClick={() => dispatch({ type: 'REORDER_STOCK', from: i, to: i + 1 })}
                        disabled={i === state.level.stock.length - 1}
                        title="Move later"
                      >
                        ▸
                      </button>
                      <button
                        className="editor-btn small danger"
                        onClick={() => dispatch({ type: 'DELETE_STOCK', index: i })}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </main>

        <aside className="editor-rail editor-rail-right">
          <div className="editor-rail-title">Validation</div>
          <div className="editor-rail-content">
            {state.lastError && (
              <div className="warn-row warn-error">{state.lastError}</div>
            )}
            {fillError && (
              <div className="warn-row warn-error">Fill: {fillError}</div>
            )}
            {validation.warnings.length === 0 ? (
              <div className="editor-empty">No issues.</div>
            ) : (
              validation.warnings.map((w, i) => (
                <div
                  key={i}
                  className={`warn-row${w.severity === 'error' ? ' warn-error' : w.severity === 'info' ? ' warn-info' : ''}`}
                >
                  {w.text}
                </div>
              ))
            )}
            <div className="warn-stats">
              <div>Board: {validation.totalBoard}</div>
              <div>Stock: {validation.totalStock}</div>
              <div>Side-blocked at start: {validation.sideBlockedCount}</div>
              <div>Covered at start: {validation.coveredCount}</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

