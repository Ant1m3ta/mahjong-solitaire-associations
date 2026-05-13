import type {
  CardKind,
  EditorAction,
  EditorState,
  SkeletonCategory,
  SkeletonLevel,
  SkeletonStockEntry,
} from './types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function emptyLevel(): SkeletonLevel {
  return {
    levelId: 'skeleton-1',
    slotsDefault: 4,
    movesLimit: 100,
    categories: [],
    board: [],
    stock: [],
  };
}

export function topLayerOf(level: SkeletonLevel): number {
  if (level.board.length === 0) return 0;
  let z = 0;
  for (const c of level.board) if (c.z > z) z = c.z;
  return z;
}

export function minZ(level: SkeletonLevel): number {
  if (level.board.length === 0) return 0;
  let z = level.board[0].z;
  for (const c of level.board) if (c.z < z) z = c.z;
  return z;
}

export function normalizeLevel(level: SkeletonLevel): { level: SkeletonLevel; shift: number } {
  if (level.board.length === 0) return { level, shift: 0 };
  const m = minZ(level);
  if (m === 0) return { level, shift: 0 };
  return {
    level: { ...level, board: level.board.map((c) => ({ ...c, z: c.z - m })) },
    shift: -m,
  };
}

export function initialEditorState(): EditorState {
  const fromStorage = loadPersistedEditorState();
  if (fromStorage) return fromStorage;
  const level = emptyLevel();
  return {
    level,
    history: [],
    brush: { letter: null, kind: 'simple' },
    currentLayer: topLayerOf(level),
    ghostBelow: true,
    ghostAbove: true,
    eraseMode: false,
    moveMode: false,
    pickedCard: null,
    stockAdvance: false,
    defaultNewCategorySize: 4,
    lastError: null,
  };
}

const STATE_STORAGE_KEY = 'editor.state.v1';
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
      ghostAbove: parsed.ghostAbove ?? true,
      eraseMode: parsed.eraseMode ?? false,
      moveMode: parsed.moveMode ?? false,
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
  'INC_SIMPLE',
  'DEC_SIMPLE',
  'PLACE_BOARD',
  'REMOVE_BOARD',
  'MOVE_BOARD',
  'REORDER_STOCK',
  'DELETE_STOCK',
  'SHUFFLE_STOCK',
  'NORMALIZE_LAYERS',
  'LOAD_SKELETON',
]);

function nextAvailableLetter(categories: SkeletonCategory[]): string | null {
  const used = new Set(categories.map((c) => c.letter));
  for (const ch of LETTERS) if (!used.has(ch)) return ch;
  return null;
}

function countOnBoard(level: SkeletonLevel, letter: string, kind: CardKind): number {
  let n = 0;
  for (const c of level.board) if (c.letter === letter && c.kind === kind) n++;
  return n;
}

function countInStock(level: SkeletonLevel, letter: string, kind: CardKind): number {
  let n = 0;
  for (const c of level.stock) if (c.letter === letter && c.kind === kind) n++;
  return n;
}

function findLastStockIndex(
  stock: SkeletonStockEntry[],
  letter: string,
  kind: CardKind,
): number {
  for (let i = stock.length - 1; i >= 0; i--) {
    if (stock[i].letter === letter && stock[i].kind === kind) return i;
  }
  return -1;
}

function findCategory(level: SkeletonLevel, letter: string): SkeletonCategory | null {
  return level.categories.find((c) => c.letter === letter) ?? null;
}

function fail(state: EditorState, msg: string): EditorState {
  return { ...state, lastError: msg };
}

function ok(state: EditorState, level: SkeletonLevel): EditorState {
  return { ...state, level, lastError: null };
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

    case 'ADD_CATEGORY': {
      const letter = nextAvailableLetter(level.categories);
      if (!letter) return fail(state, 'No more letters available.');
      const simpleCount = Math.max(0, state.defaultNewCategorySize | 0);
      const newCat: SkeletonCategory = {
        letter,
        simpleCards: simpleCount,
      };
      const newStockEntries: SkeletonStockEntry[] = [{ letter, kind: 'category' }];
      for (let i = 0; i < simpleCount; i++) {
        newStockEntries.push({ letter, kind: 'simple' });
      }
      return {
        ...state,
        level: {
          ...level,
          categories: [...level.categories, newCat],
          stock: [...level.stock, ...newStockEntries],
        },
        brush: { letter, kind: state.brush.kind },
        lastError: null,
      };
    }

    case 'REMOVE_CATEGORY': {
      const { letter } = action;
      const filteredCats = level.categories.filter((c) => c.letter !== letter);
      const filteredBoard = level.board.filter((c) => c.letter !== letter);
      const filteredStock = level.stock.filter((s) => s.letter !== letter);
      return {
        ...state,
        level: {
          ...level,
          categories: filteredCats,
          board: filteredBoard,
          stock: filteredStock,
        },
        brush:
          state.brush.letter === letter
            ? { letter: null, kind: state.brush.kind }
            : state.brush,
        lastError: null,
      };
    }

    case 'SET_PINNED_CATEGORY': {
      const cats = level.categories.map((c) =>
        c.letter === action.letter
          ? { ...c, pinnedCategoryId: action.categoryId ?? undefined }
          : c,
      );
      return ok(state, { ...level, categories: cats });
    }

    case 'INC_SIMPLE': {
      const cat = findCategory(level, action.letter);
      if (!cat) return fail(state, `Unknown category ${action.letter}.`);
      const next: SkeletonCategory = { ...cat, simpleCards: cat.simpleCards + 1 };
      const cats = level.categories.map((c) => (c.letter === action.letter ? next : c));
      const newEntry: SkeletonStockEntry = { letter: action.letter, kind: 'simple' };
      return ok(state, { ...level, categories: cats, stock: [...level.stock, newEntry] });
    }

    case 'DEC_SIMPLE': {
      const cat = findCategory(level, action.letter);
      if (!cat) return fail(state, `Unknown category ${action.letter}.`);
      if (cat.simpleCards <= 0) return fail(state, 'Count already 0.');
      const stockIdx = findLastStockIndex(level.stock, action.letter, 'simple');
      if (stockIdx < 0) {
        return fail(
          state,
          'Cannot decrement — all simples are on the board. Remove one from the board first.',
        );
      }
      const next: SkeletonCategory = { ...cat, simpleCards: cat.simpleCards - 1 };
      const cats = level.categories.map((c) => (c.letter === action.letter ? next : c));
      const stock = level.stock.filter((_, i) => i !== stockIdx);
      return ok(state, { ...level, categories: cats, stock });
    }

    case 'PLACE_BOARD': {
      const cat = findCategory(level, action.letter);
      if (!cat) return fail(state, `Unknown category ${action.letter}.`);
      const occupied = level.board.some(
        (c) => c.x === action.x && c.y === action.y && c.z === action.z,
      );
      if (occupied) return fail(state, 'Cell already has a card at this z.');
      const stockIdx = findLastStockIndex(level.stock, action.letter, action.cardKind);
      let newStock = level.stock;
      let newCats = level.categories;
      if (stockIdx >= 0) {
        newStock = level.stock.filter((_, i) => i !== stockIdx);
      } else if (action.cardKind === 'simple') {
        // Implicit simple-count bump.
        const next: SkeletonCategory = { ...cat, simpleCards: cat.simpleCards + 1 };
        newCats = level.categories.map((c) => (c.letter === action.letter ? next : c));
      } else {
        // Category card already placed somewhere — only one per group.
        return fail(state, `Category ${action.letter} card already placed.`);
      }
      const newBoard = [
        ...level.board,
        {
          x: action.x,
          y: action.y,
          z: action.z,
          letter: action.letter,
          kind: action.cardKind,
        },
      ];
      let next = ok(state, {
        ...level,
        board: newBoard,
        stock: newStock,
        categories: newCats,
      });
      // Follow the placement: layer label tracks the just-placed card.
      if (next.currentLayer !== action.z) next = { ...next, currentLayer: action.z };
      if (state.stockAdvance && newStock.length > 0) {
        const head = newStock[0];
        next = { ...next, brush: { letter: head.letter, kind: head.kind } };
      }
      return next;
    }

    case 'REMOVE_BOARD': {
      const idx = level.board.findIndex(
        (c) => c.x === action.x && c.y === action.y && c.z === action.z,
      );
      if (idx < 0) return state;
      const removed = level.board[idx];
      const newBoard = level.board.filter((_, i) => i !== idx);
      const newStock = [
        ...level.stock,
        { letter: removed.letter, kind: removed.kind },
      ];
      return ok(state, { ...level, board: newBoard, stock: newStock });
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

    case 'DELETE_STOCK': {
      const idx = action.index;
      if (idx < 0 || idx >= level.stock.length) return state;
      const entry = level.stock[idx];
      const cat = findCategory(level, entry.letter);
      if (!cat) return state;
      if (entry.kind === 'category') {
        return fail(
          state,
          `Cannot delete the category card for ${entry.letter}. Use the × on the category panel to remove the whole category.`,
        );
      }
      const next: SkeletonCategory = { ...cat, simpleCards: Math.max(0, cat.simpleCards - 1) };
      const cats = level.categories.map((c) => (c.letter === entry.letter ? next : c));
      const stock = level.stock.filter((_, i) => i !== idx);
      return ok(state, { ...level, categories: cats, stock });
    }

    case 'SET_BRUSH_LETTER':
      return {
        ...state,
        brush: { ...state.brush, letter: action.letter },
        eraseMode: false,
        moveMode: false,
        pickedCard: null,
      };

    case 'SET_BRUSH_KIND':
      return { ...state, brush: { ...state.brush, kind: action.kind } };

    case 'TOGGLE_ERASE':
      return {
        ...state,
        eraseMode: !state.eraseMode,
        moveMode: false,
        pickedCard: null,
      };

    case 'TOGGLE_MOVE':
      return {
        ...state,
        moveMode: !state.moveMode,
        eraseMode: false,
        pickedCard: null,
      };

    case 'PICK_CARD':
      return {
        ...state,
        pickedCard: { x: action.x, y: action.y, z: action.z },
        lastError: null,
      };

    case 'CANCEL_PICK':
      return { ...state, pickedCard: null, lastError: null };

    case 'MOVE_BOARD': {
      const fromIdx = level.board.findIndex(
        (c) => c.x === action.from.x && c.y === action.from.y && c.z === action.from.z,
      );
      if (fromIdx < 0) return fail(state, 'Source card not found.');
      const occupied = level.board.some(
        (c, i) =>
          i !== fromIdx && c.x === action.to.x && c.y === action.to.y && c.z === action.to.z,
      );
      if (occupied) return fail(state, 'Target cell already has a card at this z.');
      const card = level.board[fromIdx];
      const newBoard = level.board.slice();
      newBoard[fromIdx] = { ...card, x: action.to.x, y: action.to.y, z: action.to.z };
      return {
        ...ok(state, { ...level, board: newBoard }),
        pickedCard: null,
        currentLayer: action.to.z,
      };
    }

    case 'SET_LAYER':
      return { ...state, currentLayer: action.z | 0 };

    case 'NORMALIZE_LAYERS': {
      const { level: normalized, shift } = normalizeLevel(level);
      if (shift === 0) return state;
      return {
        ...state,
        level: normalized,
        currentLayer: state.currentLayer + shift,
        lastError: null,
      };
    }

    case 'LOAD_SKELETON':
      return {
        ...state,
        level: action.level,
        currentLayer: topLayerOf(action.level),
        brush: { letter: null, kind: 'simple' },
        eraseMode: false,
        lastError: null,
      };

    case 'TOGGLE_GHOST_BELOW':
      return { ...state, ghostBelow: !state.ghostBelow };

    case 'TOGGLE_GHOST_ABOVE':
      return { ...state, ghostAbove: !state.ghostAbove };

    case 'TOGGLE_STOCK_ADVANCE': {
      const turningOn = !state.stockAdvance;
      if (turningOn && level.stock.length > 0) {
        const head = level.stock[0];
        return {
          ...state,
          stockAdvance: true,
          brush: { letter: head.letter, kind: head.kind },
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
        const head = shuffled[0];
        return { ...next, brush: { letter: head.letter, kind: head.kind } };
      }
      return next;
    }
  }
}

export function categoryCounts(state: EditorState, letter: string) {
  return {
    categoryOnBoard: countOnBoard(state.level, letter, 'category'),
    categoryInStock: countInStock(state.level, letter, 'category'),
    simpleOnBoard: countOnBoard(state.level, letter, 'simple'),
    simpleInStock: countInStock(state.level, letter, 'simple'),
  };
}
