export type CardKind = 'category' | 'simple';

export interface SkeletonCategory {
  letter: string;
  simpleCards: number;
  pinnedCategoryId?: string;
  // Exact words to use, in order. When set, fill takes the first `simpleCards`
  // of these verbatim instead of picking randomly from the catalog — so the
  // editor preview is exactly what plays. Categories pinned this way need not
  // exist in the catalog (AI-generated ranges resolve here).
  pinnedWords?: string[];
}

export interface SkeletonBoardCard {
  x: number;
  y: number;
  z: number;
  letter: string;
  kind: CardKind;
}

export interface SkeletonStockEntry {
  letter: string;
  kind: CardKind;
}

export interface SkeletonLevel {
  levelId: string;
  difficulty?: string;
  slotsDefault: number;
  movesLimit: number;
  categories: SkeletonCategory[];
  board: SkeletonBoardCard[];
  stock: SkeletonStockEntry[];
}

export interface RangeAssignment {
  letter: string;
  categoryId: string;
  words: string[];
}

export interface BrushState {
  letter: string | null;
  kind: CardKind;
}

export interface HistoryEntry {
  level: SkeletonLevel;
  currentLayer: number;
}

export interface PickedCard {
  x: number;
  y: number;
  z: number;
}

export interface EditorState {
  level: SkeletonLevel;
  history: HistoryEntry[];
  brush: BrushState;
  currentLayer: number;
  ghostBelow: boolean;
  revealPreview: boolean;
  gridOutline: boolean;
  eraseMode: boolean;
  moveMode: boolean;
  pickedCard: PickedCard | null;
  stockAdvance: boolean;
  defaultNewCategorySize: number;
  lastError: string | null;
}

export type EditorAction =
  | { type: 'SET_LEVEL_ID'; id: string }
  | { type: 'SET_SLOTS'; slots: number }
  | { type: 'SET_MOVES'; moves: number }
  | { type: 'SET_DIFFICULTY'; difficulty: string | undefined }
  | { type: 'ADD_CATEGORY' }
  | { type: 'REMOVE_CATEGORY'; letter: string }
  | { type: 'SET_PINNED_CATEGORY'; letter: string; categoryId: string | null }
  | { type: 'APPLY_CATEGORY_RANGE'; assignments: RangeAssignment[] }
  | { type: 'FILL_BASIC' }
  | { type: 'FILL_WORDS' }
  | { type: 'CLEAR_PINS' }
  | { type: 'INC_SIMPLE'; letter: string }
  | { type: 'DEC_SIMPLE'; letter: string }
  | { type: 'PLACE_BOARD'; x: number; y: number; z: number; letter: string; cardKind: CardKind }
  | { type: 'REMOVE_BOARD'; x: number; y: number; z: number }
  | { type: 'REORDER_STOCK'; from: number; to: number }
  | { type: 'APPLY_STOCK_ORDER'; stock: SkeletonStockEntry[] }
  | { type: 'DELETE_STOCK'; index: number }
  | { type: 'SET_BRUSH_LETTER'; letter: string | null }
  | { type: 'SET_BRUSH_KIND'; kind: CardKind }
  | { type: 'TOGGLE_ERASE' }
  | { type: 'TOGGLE_MOVE' }
  | { type: 'PICK_CARD'; x: number; y: number; z: number }
  | { type: 'CANCEL_PICK' }
  | { type: 'MOVE_BOARD'; from: PickedCard; to: PickedCard }
  | { type: 'SET_LAYER'; z: number }
  | { type: 'TOGGLE_GHOST_BELOW' }
  | { type: 'TOGGLE_REVEAL_PREVIEW' }
  | { type: 'TOGGLE_GRID_OUTLINE' }
  | { type: 'TOGGLE_STOCK_ADVANCE' }
  | { type: 'SET_DEFAULT_NEW_CATEGORY_SIZE'; size: number }
  | { type: 'SHUFFLE_STOCK' }
  | { type: 'SHUFFLE_BOARD' }
  | { type: 'NORMALIZE_LAYERS' }
  | { type: 'LOAD_SKELETON'; level: SkeletonLevel }
  | { type: 'ROLLBACK' };
