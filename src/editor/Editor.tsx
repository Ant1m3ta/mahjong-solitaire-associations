import { useReducer, useEffect, useState, useMemo } from 'react';
import { initialEditorState, normalizeLevel, persistEditorState, reduceEditor } from './reducer';
import { CategoriesRail } from './CategoriesRail';
import { CategoryPicker } from './CategoryPicker';
import { CategoryRangePicker } from './CategoryRangePicker';
import { BatchFillModal } from './BatchFillModal';
import { BatchFixModal } from './BatchFixModal';
import { ImagesModal } from './ImagesModal';
import { ReorderModal } from './ReorderModal';
import { BoardCanvas } from './BoardCanvas';
import { useSolver, type SolverViewState } from './solver/useSolver';
import { DifficultyChip } from './DifficultyChip';
import { GreedyChip } from './GreedyChip';
import { planStockReorder } from './reorderFix';
import { fillSkeleton, FillError } from './fill';
import {
  boundSaveFolder,
  listLevelsInFolder,
  pickSaveFolder,
  saveLevelJSON,
  storePreviewAndPlay,
  supportsFileSystemAccess,
  type LevelFileEntry,
} from './save';
import { unfillLevel, UnfillError } from './unfill';
import { validate } from './validate';
import { LEVELS } from '../levels';
import type { LevelData } from '../types';

export function Editor() {
  const [state, dispatch] = useReducer(reduceEditor, undefined, initialEditorState);
  const [fillError, setFillError] = useState<string | null>(null);
  const [pickerLetter, setPickerLetter] = useState<string | null>(null);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [boundFolder, setBoundFolder] = useState<string | null>(boundSaveFolder());
  const [folderLevels, setFolderLevels] = useState<LevelFileEntry[]>([]);
  const [solverEnabled, setSolverEnabled] = useState(true);
  const [orderFixNote, setOrderFixNote] = useState<string | null>(null);
  const { solver, difficulty, greedy, runDeepAnalysis } = useSolver(state.level, solverEnabled);
  const needsFolder = supportsFileSystemAccess();
  const dropdownEntries: { label: string; level: LevelData }[] = needsFolder
    ? folderLevels.map((e) => ({ label: e.name.replace(/\.json$/, ''), level: e.level }))
    : LEVELS.map((lvl) => ({ label: `Level ${lvl.levelId}`, level: lvl }));
  const brush = state.brush;
  const brushCat = brush.letter
    ? state.level.categories.find((c) => c.letter === brush.letter) ?? null
    : null;
  const pickerCategory =
    pickerLetter ? state.level.categories.find((c) => c.letter === pickerLetter) ?? null : null;

  useEffect(() => {
    persistEditorState(state);
  }, [state]);

  // Drop a stale order-fix note once the analyzer re-runs on a fresh edit.
  useEffect(() => {
    if (greedy.status === 'analyzing') setOrderFixNote(null);
  }, [greedy.status]);

  function handleFixOrder() {
    const plan = planStockReorder(state.level);
    if (plan.status === 'fixed' && plan.order) {
      const order = plan.order;
      dispatch({ type: 'APPLY_STOCK_ORDER', stock: order.map((i) => state.level.stock[i]) });
    } else if (plan.status === 'already-fair') {
      setOrderFixNote('already fair');
    } else {
      setOrderFixNote(plan.reason ?? 'could not fix by reordering');
    }
  }

  // Re-read the bound folder whenever the batch tool opens so it reflects the
  // actual files on disk, not a stale snapshot from when the folder was picked.
  useEffect(() => {
    if ((batchOpen || fixOpen || imagesOpen || reorderOpen) && boundFolder) {
      listLevelsInFolder()
        .then(setFolderLevels)
        .catch(() => {});
    }
  }, [batchOpen, fixOpen, imagesOpen, reorderOpen, boundFolder]);

  function suggestedLevelFilename(): string {
    const id = state.level.levelId?.trim();
    if (id && id !== 'skeleton-1') {
      return /^\d+$/.test(id) ? `level${id}.json` : `${id}.json`;
    }
    const count = needsFolder ? folderLevels.length : LEVELS.length;
    return `level${count + 1}.json`;
  }

  async function handlePickFolder() {
    try {
      const name = await pickSaveFolder();
      if (name) {
        setBoundFolder(name);
        setFolderLevels(await listLevelsInFolder());
      }
      setFillError(null);
    } catch (e) {
      setFillError(`Folder: ${String(e)}`);
    }
  }

  async function handleSave() {
    try {
      const { level: normalized } = normalizeLevel(state.level);
      const filled = fillSkeleton(normalized);
      await saveLevelJSON(filled, suggestedLevelFilename());
      setFolderLevels(await listLevelsInFolder());
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

  function handleLoadBundled(e: React.ChangeEvent<HTMLSelectElement>) {
    const idx = e.target.value;
    e.target.value = '';
    if (idx === '') return;
    const entry = dropdownEntries[Number(idx)];
    if (!entry) return;
    try {
      const skel = unfillLevel(entry.level);
      dispatch({ type: 'LOAD_SKELETON', level: skel });
      setFillError(null);
    } catch (err) {
      const msg = err instanceof UnfillError ? err.message : String(err);
      setFillError(`Load: ${msg}`);
    }
  }

  const saveDisabled =
    state.level.categories.length === 0 ||
    state.level.board.length === 0 ||
    (needsFolder && !boundFolder);
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
      } else if (e.key === 'm' || e.key === 'M') {
        dispatch({ type: 'TOGGLE_MOVE' });
      } else if (e.key === 's' || e.key === 'S') {
        dispatch({ type: 'TOGGLE_SWAP' });
      } else if (e.key === 'Escape' && state.pickedCard) {
        dispatch({ type: 'CANCEL_PICK' });
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
  }, [state.currentLayer, state.brush.kind, state.level.categories, state.pickedCard]);

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
          <label>
            difficulty
            <select
              className="editor-input small"
              value={state.level.difficulty ?? ''}
              onChange={(e) =>
                dispatch({ type: 'SET_DIFFICULTY', difficulty: e.target.value || undefined })
              }
              title="Authored difficulty tag, written to the level JSON. Preserved on save."
            >
              <option value="">normal</option>
              <option value="hard">hard</option>
            </select>
          </label>
        </div>
        <div className="editor-actions">
          <div className="editor-menu-anchor">
            <button
              className={`editor-btn${toolsOpen ? ' active' : ''}`}
              onClick={() => setToolsOpen((v) => !v)}
              title="Batch tools"
            >
              Tools ▾
            </button>
            {toolsOpen && (
              <>
                <div className="editor-menu-backdrop" onClick={() => setToolsOpen(false)} />
                <div className="editor-menu">
                  <button
                    className="editor-menu-item"
                    onClick={() => {
                      setToolsOpen(false);
                      setBatchOpen(true);
                    }}
                  >
                    Fill levels from list…
                    <span className="editor-menu-hint">
                      Base fill: reassign categories from category_list.json by index; gaps become placeholders.
                    </span>
                  </button>
                  <button
                    className="editor-menu-item"
                    onClick={() => {
                      setToolsOpen(false);
                      setFixOpen(true);
                    }}
                  >
                    Fix levels…
                    <span className="editor-menu-hint">
                      Find levels with missing words and resolve them (generate words / replace category).
                    </span>
                  </button>
                  <button
                    className="editor-menu-item"
                    onClick={() => {
                      setToolsOpen(false);
                      setImagesOpen(true);
                    }}
                  >
                    Images…
                    <span className="editor-menu-hint">
                      Swap a level's categories to image-ready ones so the tiles render pictures.
                    </span>
                  </button>
                  <button
                    className="editor-menu-item"
                    onClick={() => {
                      setToolsOpen(false);
                      setReorderOpen(true);
                    }}
                  >
                    Fix draw order…
                    <span className="editor-menu-hint">
                      Find levels where straightforward play softlocks and reorder the stock to fix them (lossless).
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
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
            title="Shift all cards so the lowest z = 0 (canonical layout for saved levels)"
          >
            Normalize
          </button>
          <select
            className="level-select"
            value=""
            onChange={handleLoadBundled}
            disabled={needsFolder && !boundFolder}
            title={
              needsFolder && !boundFolder
                ? 'Pick a folder first to see its levels.'
                : 'Load a level back into the editor (converts to a fully-pinned skeleton).'
            }
          >
            <option value="">Load level…</option>
            {dropdownEntries.map((entry, i) => (
              <option key={`${entry.label}-${i}`} value={i}>
                {entry.label}
              </option>
            ))}
          </select>
          {needsFolder ? (
            <button
              className={`editor-btn${boundFolder ? ' active' : ''}`}
              onClick={handlePickFolder}
              title={
                boundFolder
                  ? `Saves write to ${boundFolder}/. Click to pick a different folder.`
                  : 'Pick a folder for level saves. Required before saving.'
              }
            >
              Folder{boundFolder ? `: ${boundFolder}` : ': pick…'}
            </button>
          ) : (
            <span
              className="editor-warn-inline"
              title="Firefox/Safari don't expose the File System Access API. Saves will trigger blob downloads to your default Downloads folder instead of writing to a chosen folder. Open the editor in Chrome/Edge/Arc/Brave for in-place folder saves."
            >
              No folder save — open in Chrome/Edge
            </span>
          )}
          <button
            className="editor-btn"
            disabled={saveDisabled}
            onClick={handleSave}
            title={
              needsFolder && !boundFolder
                ? 'Pick a save folder first.'
                : `Write ${suggestedLevelFilename()} into ${boundFolder ?? 'the chosen folder'} (overwrites if it exists). When saved into src/levels/, the next build picks it up automatically.`
            }
          >
            Save .json → {suggestedLevelFilename()}
          </button>
          <button className="editor-btn primary" disabled={saveDisabled} onClick={handlePlay}>
            Play
          </button>
        </div>
      </div>

      <div className="editor-body">
        <CategoriesRail
          state={state}
          dispatch={dispatch}
          onOpenPicker={setPickerLetter}
          onOpenRangePicker={() => setRangePickerOpen(true)}
        />

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
              <button
                className="editor-btn small"
                onClick={() => dispatch({ type: 'SHUFFLE_BOARD' })}
                disabled={state.level.board.length <= 1}
                title="Randomize every board card's identity while keeping (x, y, z) positions unchanged."
              >
                Shuffle board
              </button>
            </div>
            <div className="brush-control">
              <span className="brush-label">Brush:</span>
              {state.eraseMode ? (
                <span className="brush-current erase">Erase</span>
              ) : state.moveMode ? (
                <span className="brush-current move">
                  Move
                  {state.pickedCard
                    ? ` · picked (${state.pickedCard.x},${state.pickedCard.y},z=${state.pickedCard.z})`
                    : ' · pick a card'}
                </span>
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
              <button
                className={`editor-btn small${state.moveMode ? ' active move-active' : ''}`}
                onClick={() => dispatch({ type: 'TOGGLE_MOVE' })}
                title="Move mode (M): click a card to pick up, click a cell to drop."
              >
                Move
              </button>
              <button
                className={`editor-btn small${state.swapMode ? ' active swap-active' : ''}`}
                onClick={() => dispatch({ type: 'TOGGLE_SWAP' })}
                title="Swap mode (S): click a simple card (board or stock) to swap it with its category card. The clicked card becomes the category card; the previous category card becomes simple."
              >
                Swap
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
              <label title="Preview in-game reveal: show every card face-up if it is uncovered (the shared isSlotRevealed rule) or face-down if covered, ignoring the current layer. Editing still acts on the current layer.">
                <input
                  type="checkbox"
                  checked={state.revealPreview}
                  onChange={() => dispatch({ type: 'TOGGLE_REVEAL_PREVIEW' })}
                />
                reveal preview
              </label>
              <label title="Show a 5×5 full-card playfield outline at the origin as an authoring guide.">
                <input
                  type="checkbox"
                  checked={state.gridOutline}
                  onChange={() => dispatch({ type: 'TOGGLE_GRID_OUTLINE' })}
                />
                5×5 outline
              </label>
            </div>
            <div className="solver-control">
              <label title="Compute an optimal move sequence to win the level. Each board card gets a badge with the move number on which it leaves the board.">
                <input
                  type="checkbox"
                  checked={solverEnabled}
                  onChange={(e) => setSolverEnabled(e.target.checked)}
                />
                solver
              </label>
              {solverEnabled && (
                <>
                  <SolverStatus status={solver} movesLimit={state.level.movesLimit} />
                  <DifficultyChip
                    difficulty={difficulty}
                    runDeepAnalysis={runDeepAnalysis}
                  />
                  <GreedyChip
                    greedy={greedy}
                    solver={solver}
                    onFixOrder={handleFixOrder}
                    fixNote={orderFixNote}
                  />
                </>
              )}
            </div>
          </div>
          <BoardCanvas
            state={state}
            dispatch={dispatch}
            moveIndexByCellKey={solverEnabled ? solver.moveIndexByCellKey : undefined}
          />
          <div className="editor-stock">
            <div className="editor-stock-title">
              <span>
                Stock <span className="dim">({state.level.stock.length} cards, first drawn →)</span>
              </span>
              <label
                className="editor-stock-advance"
                title="After each placement, set brush to the next card in the stock. Use Shuffle to randomize the stock order."
              >
                <input
                  type="checkbox"
                  checked={state.stockAdvance}
                  onChange={() => dispatch({ type: 'TOGGLE_STOCK_ADVANCE' })}
                />
                auto-advance from stock
              </label>
              <button
                className="editor-btn small editor-stock-shuffle"
                onClick={() => dispatch({ type: 'SHUFFLE_STOCK' })}
                disabled={state.level.stock.length <= 1}
                title="Randomize stock order. Pairs with auto-advance from stock."
              >
                Shuffle
              </button>
            </div>
            <div className="editor-stock-strip">
              {state.level.stock.length === 0 ? (
                <div className="editor-empty">Empty.</div>
              ) : (
                state.level.stock.map((entry, i) => (
                  <div key={i} className={`stock-chip kind-${entry.kind}${i === 0 ? ' is-next' : ''}`}>
                    <button
                      type="button"
                      className={`stock-chip-card${state.swapMode ? ' swap-armed' : ''}`}
                      onClick={() =>
                        dispatch(
                          state.swapMode
                            ? { type: 'SWAP_LOCK', target: { where: 'stock', index: i } }
                            : { type: 'PROMOTE_STOCK', index: i },
                        )
                      }
                      title={
                        state.swapMode
                          ? 'Swap mode: swap this card with its category card (this becomes the category card)'
                          : 'Select this card and move it to the top of the placement queue'
                      }
                    >
                      <span>{entry.kind === 'category' ? entry.letter : entry.letter.toLowerCase()}</span>
                    </button>
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
              <div>Covered at start: {validation.coveredCount}</div>
            </div>
          </div>
        </aside>
      </div>
      {pickerLetter && pickerCategory && (
        <CategoryPicker
          letter={pickerLetter}
          category={pickerCategory}
          dispatch={dispatch}
          onClose={() => setPickerLetter(null)}
        />
      )}
      {rangePickerOpen && (
        <CategoryRangePicker
          categories={state.level.categories}
          dispatch={dispatch}
          onClose={() => setRangePickerOpen(false)}
        />
      )}
      {batchOpen && (
        <BatchFillModal
          entries={folderLevels}
          needsFolder={needsFolder}
          boundFolder={boundFolder}
          onPickFolder={handlePickFolder}
          onWrote={async () => setFolderLevels(await listLevelsInFolder())}
          onClose={() => setBatchOpen(false)}
        />
      )}
      {fixOpen && (
        <BatchFixModal
          entries={folderLevels}
          needsFolder={needsFolder}
          boundFolder={boundFolder}
          onPickFolder={handlePickFolder}
          onWrote={async () => setFolderLevels(await listLevelsInFolder())}
          onClose={() => setFixOpen(false)}
        />
      )}
      {imagesOpen && (
        <ImagesModal
          entries={folderLevels}
          needsFolder={needsFolder}
          boundFolder={boundFolder}
          onPickFolder={handlePickFolder}
          onWrote={async () => setFolderLevels(await listLevelsInFolder())}
          onClose={() => setImagesOpen(false)}
        />
      )}
      {reorderOpen && (
        <ReorderModal
          entries={folderLevels}
          needsFolder={needsFolder}
          boundFolder={boundFolder}
          onPickFolder={handlePickFolder}
          onWrote={async () => setFolderLevels(await listLevelsInFolder())}
          onClose={() => setReorderOpen(false)}
        />
      )}
    </div>
  );
}

function SolverStatus({
  status,
  movesLimit,
}: {
  status: SolverViewState;
  movesLimit: number;
}) {
  const stats =
    status.statesExplored !== undefined
      ? ` · ${status.statesExplored.toLocaleString()} states in ${Math.round(status.elapsedMs ?? 0)}ms`
      : '';
  switch (status.status) {
    case 'idle':
      return <span className="solver-status idle">idle</span>;
    case 'solving':
      return <span className="solver-status solving">solving…</span>;
    case 'solved': {
      const used = status.movesUsed ?? 0;
      const overLimit = movesLimit >= 0 && used > movesLimit;
      return (
        <span className={`solver-status solved${overLimit ? ' over-limit' : ''}`}>
          solvable in {used} move{used === 1 ? '' : 's'}
          {movesLimit >= 0 && ` (limit ${movesLimit}${overLimit ? ' — too tight' : ''})`}
          {stats}
        </span>
      );
    }
    case 'unsolvable':
      return <span className="solver-status unsolvable">unsolvable{stats}</span>;
    case 'timeout':
      return (
        <span className="solver-status timeout" title={status.message}>
          too complex{stats}
        </span>
      );
    case 'invalid':
      return (
        <span className="solver-status invalid" title={status.message}>
          {status.message ?? 'invalid'}
        </span>
      );
    case 'empty':
      return <span className="solver-status empty">no board / stock</span>;
  }
}

