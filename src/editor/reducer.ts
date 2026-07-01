import type { AlignAnchor, EditorAction, EditorState } from './types';
import type { LevelData } from '../types';
import { BASIC_FILL, WORD_FILL } from './basics';
import {
  LETTERS,
  emptyLevel,
  isPlaceholderCategory,
  buildResolver,
  categoryIndexById,
  simpleCounts,
  addPlaceholderCategory,
  setCategory,
  unsetCategory,
  addSimpleWord,
  removeSimpleFromStock,
} from './editorLevel';

export { emptyLevel } from './editorLevel';

export function topLayerOf(level: LevelData): number {
  if (level.board.length === 0) return 0;
  let z = 0;
  for (const c of level.board) if (c.z > z) z = c.z;
  return z;
}

export function minZ(level: LevelData): number {
  if (level.board.length === 0) return 0;
  let z = level.board[0].z;
  for (const c of level.board) if (c.z < z) z = c.z;
  return z;
}

// Shift every board card so the lowest z = 0 (the canonical layout for a saved
// level). Returns the new level and the z-shift applied (to follow currentLayer).
export function normalizeLevel(level: LevelData): { level: LevelData; shift: number } {
  if (level.board.length === 0) return { level, shift: 0 };
  const m = minZ(level);
  if (m === 0) return { level, shift: 0 };
  return {
    level: { ...level, board: level.board.map((c) => ({ ...c, z: c.z - m })) },
    shift: -m,
  };
}

// 5×5 playfield outline, in half-card units (mirrors BoardCanvas's outline).
const CARD_SPAN = 2;
const OUTLINE_SPAN = 5 * CARD_SPAN;

function alignOffset(anchor: AlignAnchor, min: number, size: number): number {
  if (anchor === 'start') return -min;
  if (anchor === 'end') return OUTLINE_SPAN - size - min;
  return Math.round((OUTLINE_SPAN - size) / 2) - min;
}

export function initialEditorState(): EditorState {
  const fromStorage = loadPersistedEditorState();
  if (fromStorage) return fromStorage;
  const level = emptyLevel();
  return {
    level,
    history: [],
    brush: { categoryId: null, kind: 'simple' },
    currentLayer: topLayerOf(level),
    ghostBelow: true,
    gridOutline: true,
    eraseMode: false,
    moveMode: false,
    swapMode: false,
    pickedCard: null,
    stockAdvance: false,
    defaultNewCategorySize: 4,
    lastError: null,
  };
}

// v2: the working state is now a LevelData (was a SkeletonLevel under v1), so a
// stale v1 blob is ignored and the editor starts fresh.
const STATE_STORAGE_KEY = 'editor.state.v2';
const HISTORY_CAP = 100;

function loadPersistedEditorState(): EditorState | null {
  try {
    const raw = sessionStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorState>;
    if (!parsed.level || !Array.isArray(parsed.history) || !parsed.brush) return null;
    return {
      level: parsed.level,
      history: parsed.history,
      brush: parsed.brush,
      currentLayer: typeof parsed.currentLayer === 'number' ? parsed.currentLayer : 0,
      ghostBelow: parsed.ghostBelow ?? true,
      gridOutline: parsed.gridOutline ?? true,
      eraseMode: parsed.eraseMode ?? false,
      moveMode: parsed.moveMode ?? false,
      swapMode: parsed.swapMode ?? false,
      pickedCard: parsed.pickedCard ?? null,
      stockAdvance: parsed.stockAdvance ?? false,
      defaultNewCategorySize:
        typeof parsed.defaultNewCategorySize === 'number' ? parsed.defaultNewCategorySize : 4,
      lastError: null,
    };
  } catch {
    return null;
  }
}

export function persistEditorState(state: EditorState): void {
  try {
    const trimmed: EditorState = {
      ...state,
      history: state.history.slice(-HISTORY_CAP),
      lastError: null,
    };
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore quota / serialization errors — persistence is best-effort.
  }
}

export function clearPersistedEditorState(): void {
  try {
    sessionStorage.removeItem(STATE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const HISTORY_ACTIONS: ReadonlySet<EditorAction['type']> = new Set([
  'ADD_CATEGORY',
  'REMOVE_CATEGORY',
  'SET_PINNED_CATEGORY',
  'APPLY_CATEGORY_RANGE',
  'FILL_BASIC',
  'FILL_WORDS',
  'CLEAR_PINS',
  'INC_SIMPLE',
  'DEC_SIMPLE',
  'PLACE_BOARD',
  'REMOVE_BOARD',
  'MOVE_BOARD',
  'SWAP_LOCK',
  'REORDER_STOCK',
  'PROMOTE_STOCK',
  'APPLY_STOCK_ORDER',
  'DELETE_STOCK',
  'SHUFFLE_STOCK',
  'SHUFFLE_BOARD',
  'NORMALIZE_LAYERS',
  'ALIGN_BOARD',
  'LOAD_LEVEL',
]);

function fail(state: EditorState, msg: string): EditorState {
  return { ...state, lastError: msg };
}

function ok(state: EditorState, level: LevelData): EditorState {
  return { ...state, level, lastError: null };
}

// After a rewrite that may change category ids, keep the brush pointed at the
// SAME category slot (by its pre-rewrite position).
function brushAfterRewrite(
  brush: EditorState['brush'],
  oldLevel: LevelData,
  newLevel: LevelData,
): EditorState['brush'] {
  if (!brush.categoryId) return brush;
  const i = categoryIndexById(oldLevel, brush.categoryId);
  if (i < 0 || i >= newLevel.categories.length) return brush;
  return { ...brush, categoryId: newLevel.categories[i].categoryId };
}

export function reduceEditor(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'ROLLBACK') {
    if (state.history.length === 0) return state;
    const prev = state.history[state.history.length - 1];
    return {
      ...state,
      level: prev.level,
      currentLayer: prev.currentLayer,
      history: state.history.slice(0, -1),
      lastError: null,
    };
  }
  const oldLevel = state.level;
  const oldCurrentLayer = state.currentLayer;
  const next = reduceCore(state, action);
  if (HISTORY_ACTIONS.has(action.type) && next.level !== oldLevel) {
    return {
      ...next,
      history: [...state.history, { level: oldLevel, currentLayer: oldCurrentLayer }],
    };
  }
  return next;
}

function reduceCore(state: EditorState, action: Exclude<EditorAction, { type: 'ROLLBACK' }>): EditorState {
  const level = state.level;

  switch (action.type) {
    case 'SET_LEVEL_ID':
      return ok(state, { ...level, levelId: action.id });

    case 'SET_SLOTS':
      return ok(state, { ...level, slotsDefault: Math.max(1, Math.min(6, action.slots | 0)) });

    case 'SET_MOVES':
      return ok(state, { ...level, movesLimit: action.moves | 0 });

    case 'SET_DIFFICULTY': {
      const next = { ...level };
      if (action.difficulty) next.difficulty = action.difficulty;
      else delete next.difficulty;
      return ok(state, next);
    }

    case 'ADD_CATEGORY': {
      const size = Math.max(0, state.defaultNewCategorySize | 0);
      const { level: next, categoryId } = addPlaceholderCategory(level, size);
      return {
        ...state,
        level: next,
        brush: { categoryId, kind: state.brush.kind },
        lastError: null,
      };
    }

    case 'REMOVE_CATEGORY': {
      const { index } = action;
      if (index < 0 || index >= level.categories.length) return state;
      const removedId = level.categories[index].categoryId;
      const resolve = buildResolver(level);
      const board = level.board.filter((b) => resolve(b.cardId).index !== index);
      const stock = level.stock.filter((id) => resolve(id).index !== index);
      const categories = level.categories.filter((_, i) => i !== index);
      return {
        ...state,
        level: { ...level, categories, board, stock },
        brush:
          state.brush.categoryId === removedId
            ? { categoryId: null, kind: state.brush.kind }
            : state.brush,
        lastError: null,
      };
    }

    case 'SET_PINNED_CATEGORY': {
      const { index } = action;
      if (index < 0 || index >= level.categories.length) return state;
      const next = action.categoryId
        ? setCategory(level, index, action.categoryId)
        : unsetCategory(level, index);
      return { ...ok(state, next), brush: brushAfterRewrite(state.brush, level, next) };
    }

    case 'APPLY_CATEGORY_RANGE': {
      const next = applyRewrites(
        level,
        action.assignments.map((a) => ({ index: a.index, categoryId: a.categoryId, words: a.words })),
      );
      return { ...ok(state, next), brush: brushAfterRewrite(state.brush, level, next) };
    }

    case 'FILL_BASIC': {
      const next = applyRewrites(
        level,
        level.categories.map((_, i) => {
          const basic = BASIC_FILL.find((b) => b.letter === LETTERS[i]);
          if (!basic) return null;
          return { index: i, categoryId: basic.categoryId, words: basic.words.slice(0, simpleCounts(level)[i]) };
        }),
      );
      return { ...ok(state, next), brush: brushAfterRewrite(state.brush, level, next) };
    }

    case 'FILL_WORDS': {
      const rewrites = level.categories.map((_, i) => {
        const categoryId = WORD_FILL[LETTERS[i]];
        return categoryId ? { index: i, categoryId } : null;
      });
      const next = applyRewrites(level, rewrites);
      const result = { ...ok(state, next), brush: brushAfterRewrite(state.brush, level, next) };
      const missing = rewrites.filter((r) => r === null).length;
      if (missing > 0) {
        return {
          ...result,
          lastError: `${missing} categor${missing === 1 ? 'y' : 'ies'} left unpinned — no mapping in WORD_FILL.`,
        };
      }
      return result;
    }

    case 'CLEAR_PINS': {
      let next = level;
      level.categories.forEach((c, i) => {
        if (!isPlaceholderCategory(c.categoryId)) next = unsetCategory(next, i);
      });
      if (next === level) return state;
      return { ...ok(state, next), brush: brushAfterRewrite(state.brush, level, next) };
    }

    case 'INC_SIMPLE': {
      const { index } = action;
      if (index < 0 || index >= level.categories.length) return fail(state, 'Unknown category.');
      const { level: l2, cardId } = addSimpleWord(level, index);
      return ok(state, { ...l2, stock: [...l2.stock, cardId] });
    }

    case 'DEC_SIMPLE': {
      const { index } = action;
      if (index < 0 || index >= level.categories.length) return fail(state, 'Unknown category.');
      const next = removeSimpleFromStock(level, index);
      if (!next) {
        return fail(
          state,
          'Cannot decrement — all simples are on the board. Remove one from the board first.',
        );
      }
      return ok(state, next);
    }

    case 'PLACE_BOARD': {
      const idx = categoryIndexById(level, action.categoryId);
      if (idx < 0) return fail(state, 'Unknown category.');
      if (level.board.some((b) => b.x === action.x && b.y === action.y && b.z === action.z)) {
        return fail(state, 'Cell already has a card at this z.');
      }
      const resolve = buildResolver(level);
      let working = level;
      let cardId: string;
      let newStock = level.stock;
      if (action.cardKind === 'category') {
        if (level.board.some((b) => b.cardId === action.categoryId)) {
          return fail(state, 'Category card already placed.');
        }
        const si = level.stock.indexOf(action.categoryId);
        if (si < 0) return fail(state, 'Category card is not available to place.');
        cardId = action.categoryId;
        newStock = level.stock.filter((_, i) => i !== si);
      } else {
        let si = -1;
        for (let i = 0; i < level.stock.length; i++) {
          const r = resolve(level.stock[i]);
          if (r.index === idx && r.kind === 'simple') {
            si = i;
            break;
          }
        }
        if (si >= 0) {
          cardId = level.stock[si];
          newStock = level.stock.filter((_, i) => i !== si);
        } else {
          const added = addSimpleWord(level, idx);
          working = added.level;
          cardId = added.cardId;
          newStock = added.level.stock;
        }
      }
      const board = [...working.board, { x: action.x, y: action.y, z: action.z, cardId }];
      let next = ok(state, { ...working, board, stock: newStock });
      if (next.currentLayer !== action.z) next = { ...next, currentLayer: action.z };
      if (state.stockAdvance && newStock.length > 0) {
        const r = buildResolver({ ...working, stock: newStock })(newStock[0]);
        const headCat = next.level.categories[r.index]?.categoryId ?? null;
        next = { ...next, brush: { categoryId: headCat, kind: r.kind } };
      }
      return next;
    }

    case 'REMOVE_BOARD': {
      const idx = level.board.findIndex(
        (c) => c.x === action.x && c.y === action.y && c.z === action.z,
      );
      if (idx < 0) return state;
      const removed = level.board[idx];
      const board = level.board.filter((_, i) => i !== idx);
      const stock = [...level.stock, removed.cardId];
      return ok(state, { ...level, board, stock });
    }

    case 'REORDER_STOCK': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0) return state;
      if (from >= level.stock.length || to >= level.stock.length) return state;
      const copy = level.stock.slice();
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return ok(state, { ...level, stock: copy });
    }

    case 'PROMOTE_STOCK': {
      const idx = action.index;
      if (idx < 0 || idx >= level.stock.length) return state;
      const moved = level.stock[idx];
      const r = buildResolver(level)(moved);
      const select = {
        brush: { categoryId: level.categories[r.index]?.categoryId ?? null, kind: r.kind },
        eraseMode: false,
        moveMode: false,
        pickedCard: null,
      };
      if (idx === 0) return { ...state, ...select, lastError: null };
      const stock = level.stock.slice();
      stock.splice(idx, 1);
      stock.unshift(moved);
      return { ...ok(state, { ...level, stock }), ...select };
    }

    case 'APPLY_STOCK_ORDER': {
      if (action.stock.length !== level.stock.length) return state;
      return ok(state, { ...level, stock: action.stock });
    }

    case 'DELETE_STOCK': {
      const idx = action.index;
      if (idx < 0 || idx >= level.stock.length) return state;
      const entry = level.stock[idx];
      const r = buildResolver(level)(entry);
      if (r.kind === 'category') {
        return fail(
          state,
          'Cannot delete a category card from the stock. Use the × on the category panel to remove the whole category.',
        );
      }
      const stock = level.stock.filter((_, i) => i !== idx);
      const stillReferenced = stock.includes(entry) || level.board.some((b) => b.cardId === entry);
      const categories = stillReferenced
        ? level.categories
        : level.categories.map((c, i) => {
            if (i !== r.index) return c;
            let dropped = false;
            return {
              ...c,
              wordsData: c.wordsData.filter((w) => {
                if (!dropped && w.wordId === entry) {
                  dropped = true;
                  return false;
                }
                return true;
              }),
            };
          });
      return ok(state, { ...level, categories, stock });
    }

    case 'SET_BRUSH_CATEGORY':
      return {
        ...state,
        brush: { ...state.brush, categoryId: action.categoryId },
        eraseMode: false,
        moveMode: false,
        pickedCard: null,
      };

    case 'SET_BRUSH_KIND':
      return { ...state, brush: { ...state.brush, kind: action.kind } };

    case 'TOGGLE_ERASE':
      return { ...state, eraseMode: !state.eraseMode, moveMode: false, swapMode: false, pickedCard: null };

    case 'TOGGLE_MOVE':
      return { ...state, moveMode: !state.moveMode, eraseMode: false, swapMode: false, pickedCard: null };

    case 'TOGGLE_SWAP':
      return { ...state, swapMode: !state.swapMode, eraseMode: false, moveMode: false, pickedCard: null };

    case 'SWAP_LOCK': {
      const t = action.target;
      const resolve = buildResolver(level);
      let clickedId: string;
      if (t.where === 'board') {
        const b = level.board.find((c) => c.x === t.x && c.y === t.y && c.z === t.z);
        if (!b) return state;
        clickedId = b.cardId;
      } else {
        if (t.index < 0 || t.index >= level.stock.length) return state;
        clickedId = level.stock[t.index];
      }
      const r = resolve(clickedId);
      if (r.kind === 'category') {
        return fail(state, 'Already the category card — click a simple card to swap it here.');
      }
      const catId = level.categories[r.index].categoryId;
      // Swap the clicked card's id with the category's lock card (cardId === catId),
      // wherever it sits. Only the two positions' ids change.
      const swap = (id: string): string => (id === clickedId ? catId : id === catId ? clickedId : id);
      const board = level.board.map((b) => (b.cardId === clickedId || b.cardId === catId ? { ...b, cardId: swap(b.cardId) } : b));
      const stock = level.stock.map(swap);
      return ok(state, { ...level, board, stock });
    }

    case 'PICK_CARD':
      return { ...state, pickedCard: { x: action.x, y: action.y, z: action.z }, lastError: null };

    case 'CANCEL_PICK':
      return { ...state, pickedCard: null, lastError: null };

    case 'MOVE_BOARD': {
      const fromIdx = level.board.findIndex(
        (c) => c.x === action.from.x && c.y === action.from.y && c.z === action.from.z,
      );
      if (fromIdx < 0) return fail(state, 'Source card not found.');
      const occupied = level.board.some(
        (c, i) => i !== fromIdx && c.x === action.to.x && c.y === action.to.y && c.z === action.to.z,
      );
      if (occupied) return fail(state, 'Target cell already has a card at this z.');
      const card = level.board[fromIdx];
      const board = level.board.slice();
      board[fromIdx] = { ...card, x: action.to.x, y: action.to.y, z: action.to.z };
      return { ...ok(state, { ...level, board }), pickedCard: null, currentLayer: action.to.z };
    }

    case 'SET_LAYER':
      return { ...state, currentLayer: action.z | 0 };

    case 'NORMALIZE_LAYERS': {
      const { level: normalized, shift } = normalizeLevel(level);
      if (shift === 0) return state;
      return { ...state, level: normalized, currentLayer: state.currentLayer + shift, lastError: null };
    }

    case 'ALIGN_BOARD': {
      if (level.board.length === 0) return state;
      let minX = level.board[0].x;
      let maxX = minX;
      let minY = level.board[0].y;
      let maxY = minY;
      for (const c of level.board) {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      const dx = alignOffset(action.anchorX, minX, maxX - minX + CARD_SPAN);
      const dy = alignOffset(action.anchorY, minY, maxY - minY + CARD_SPAN);
      if (dx === 0 && dy === 0) return state;
      const board = level.board.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
      return ok(state, { ...level, board });
    }

    case 'LOAD_LEVEL':
      return {
        ...state,
        level: action.level,
        currentLayer: topLayerOf(action.level),
        brush: { categoryId: null, kind: 'simple' },
        eraseMode: false,
        lastError: null,
      };

    case 'TOGGLE_GHOST_BELOW':
      return { ...state, ghostBelow: !state.ghostBelow };

    case 'TOGGLE_GRID_OUTLINE':
      return { ...state, gridOutline: !state.gridOutline };

    case 'TOGGLE_STOCK_ADVANCE': {
      const turningOn = !state.stockAdvance;
      if (turningOn && level.stock.length > 0) {
        const r = buildResolver(level)(level.stock[0]);
        return {
          ...state,
          stockAdvance: true,
          brush: { categoryId: level.categories[r.index]?.categoryId ?? null, kind: r.kind },
          lastError: null,
        };
      }
      return { ...state, stockAdvance: turningOn, lastError: null };
    }

    case 'SET_DEFAULT_NEW_CATEGORY_SIZE':
      return { ...state, defaultNewCategorySize: Math.max(0, action.size | 0) };

    case 'SHUFFLE_STOCK': {
      if (level.stock.length <= 1) return state;
      const shuffled = level.stock.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const next = ok(state, { ...level, stock: shuffled });
      if (state.stockAdvance) {
        const r = buildResolver(level)(shuffled[0]);
        return { ...next, brush: { categoryId: level.categories[r.index]?.categoryId ?? null, kind: r.kind } };
      }
      return next;
    }

    case 'SHUFFLE_BOARD': {
      if (level.board.length <= 1) return state;
      const ids = level.board.map((c) => c.cardId);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      const board = level.board.map((c, i) => ({ ...c, cardId: ids[i] }));
      return ok(state, { ...level, board });
    }
  }
}

// Apply a batch of (possibly null) rewrites, dropping the no-ops.
function applyRewrites(
  level: LevelData,
  rewrites: ({ index: number; categoryId: string; words?: string[] } | null)[],
): LevelData {
  const real = rewrites.filter((r): r is { index: number; categoryId: string; words?: string[] } => r !== null);
  if (real.length === 0) return level;
  // Sequential so each catalog pick (words omitted, e.g. Fill words) dedups
  // against categories already rewritten in this batch. Rewriting never changes
  // tile counts, so per-call simpleCounts stays stable.
  return real.reduce((lvl, r) => setCategory(lvl, r.index, r.categoryId, r.words), level);
}

export function categoryCounts(state: EditorState, index: number) {
  const level = state.level;
  const resolve = buildResolver(level);
  let categoryOnBoard = 0;
  let categoryInStock = 0;
  let simpleOnBoard = 0;
  let simpleInStock = 0;
  for (const b of level.board) {
    const r = resolve(b.cardId);
    if (r.index !== index) continue;
    if (r.kind === 'category') categoryOnBoard++;
    else simpleOnBoard++;
  }
  for (const id of level.stock) {
    const r = resolve(id);
    if (r.index !== index) continue;
    if (r.kind === 'category') categoryInStock++;
    else simpleInStock++;
  }
  return { categoryOnBoard, categoryInStock, simpleOnBoard, simpleInStock };
}
