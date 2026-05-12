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

export function initialEditorState(): EditorState {
  return {
    level: emptyLevel(),
    brush: { letter: null, kind: 'simple' },
    currentLayer: 0,
    ghostBelow: true,
    ghostAbove: true,
    eraseMode: false,
    lastError: null,
  };
}

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
      const newCat: SkeletonCategory = {
        letter,
        kind: 'any',
        categoryCards: 1,
        simpleCards: 0,
      };
      return {
        ...state,
        level: {
          ...level,
          categories: [...level.categories, newCat],
          stock: [...level.stock, { letter, kind: 'category' }],
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

    case 'SET_CATEGORY_KIND': {
      const cats = level.categories.map((c) =>
        c.letter === action.letter ? { ...c, kind: action.kind } : c,
      );
      return ok(state, { ...level, categories: cats });
    }

    case 'INC_COUNT': {
      const cat = findCategory(level, action.letter);
      if (!cat) return fail(state, `Unknown category ${action.letter}.`);
      const next: SkeletonCategory =
        action.cardKind === 'category'
          ? { ...cat, categoryCards: cat.categoryCards + 1 }
          : { ...cat, simpleCards: cat.simpleCards + 1 };
      const cats = level.categories.map((c) => (c.letter === action.letter ? next : c));
      const newEntry: SkeletonStockEntry = { letter: action.letter, kind: action.cardKind };
      return ok(state, { ...level, categories: cats, stock: [...level.stock, newEntry] });
    }

    case 'DEC_COUNT': {
      const cat = findCategory(level, action.letter);
      if (!cat) return fail(state, `Unknown category ${action.letter}.`);
      const current =
        action.cardKind === 'category' ? cat.categoryCards : cat.simpleCards;
      if (current <= 0) return fail(state, 'Count already 0.');
      const stockIdx = findLastStockIndex(level.stock, action.letter, action.cardKind);
      if (stockIdx < 0) {
        return fail(
          state,
          'Cannot decrement — all cards are on the board. Remove one from the board first.',
        );
      }
      const next: SkeletonCategory =
        action.cardKind === 'category'
          ? { ...cat, categoryCards: cat.categoryCards - 1 }
          : { ...cat, simpleCards: cat.simpleCards - 1 };
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
      } else {
        // Implicit count bump.
        const next: SkeletonCategory =
          action.cardKind === 'category'
            ? { ...cat, categoryCards: cat.categoryCards + 1 }
            : { ...cat, simpleCards: cat.simpleCards + 1 };
        newCats = level.categories.map((c) => (c.letter === action.letter ? next : c));
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
      return ok(state, {
        ...level,
        board: newBoard,
        stock: newStock,
        categories: newCats,
      });
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
      const next: SkeletonCategory =
        entry.kind === 'category'
          ? { ...cat, categoryCards: Math.max(0, cat.categoryCards - 1) }
          : { ...cat, simpleCards: Math.max(0, cat.simpleCards - 1) };
      const cats = level.categories.map((c) => (c.letter === entry.letter ? next : c));
      const stock = level.stock.filter((_, i) => i !== idx);
      return ok(state, { ...level, categories: cats, stock });
    }

    case 'SET_BRUSH_LETTER':
      return { ...state, brush: { ...state.brush, letter: action.letter }, eraseMode: false };

    case 'SET_BRUSH_KIND':
      return { ...state, brush: { ...state.brush, kind: action.kind } };

    case 'TOGGLE_ERASE':
      return { ...state, eraseMode: !state.eraseMode };

    case 'SET_LAYER':
      return { ...state, currentLayer: Math.max(0, action.z | 0) };

    case 'TOGGLE_GHOST_BELOW':
      return { ...state, ghostBelow: !state.ghostBelow };

    case 'TOGGLE_GHOST_ABOVE':
      return { ...state, ghostAbove: !state.ghostAbove };
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
