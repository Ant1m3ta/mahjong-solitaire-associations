export type CardKind = 'category' | 'simple';

export interface SkeletonCategory {
  letter: string;
  simpleCards: number;
  pinnedCategoryId?: string;
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
  slotsDefault: number;
  movesLimit: number;
  categories: SkeletonCategory[];
  board: SkeletonBoardCard[];
  stock: SkeletonStockEntry[];
}

export interface BrushState {
  letter: string | null;
  kind: CardKind;
}

export interface HistoryEntry {
  level: SkeletonLevel;
  currentLayer: number;
}

export interface EditorState {
  level: SkeletonLevel;
  history: HistoryEntry[];
  brush: BrushState;
  currentLayer: number;
  ghostBelow: boolean;
  ghostAbove: boolean;
  eraseMode: boolean;
  lastError: string | null;
}

export type EditorAction =
  | { type: 'SET_LEVEL_ID'; id: string }
  | { type: 'SET_SLOTS'; slots: number }
  | { type: 'SET_MOVES'; moves: number }
  | { type: 'ADD_CATEGORY' }
  | { type: 'REMOVE_CATEGORY'; letter: string }
  | { type: 'SET_PINNED_CATEGORY'; letter: string; categoryId: string | null }
  | { type: 'INC_SIMPLE'; letter: string }
  | { type: 'DEC_SIMPLE'; letter: string }
  | { type: 'PLACE_BOARD'; x: number; y: number; z: number; letter: string; cardKind: CardKind }
  | { type: 'REMOVE_BOARD'; x: number; y: number; z: number }
  | { type: 'REORDER_STOCK'; from: number; to: number }
  | { type: 'DELETE_STOCK'; index: number }
  | { type: 'SET_BRUSH_LETTER'; letter: string | null }
  | { type: 'SET_BRUSH_KIND'; kind: CardKind }
  | { type: 'TOGGLE_ERASE' }
  | { type: 'SET_LAYER'; z: number }
  | { type: 'TOGGLE_GHOST_BELOW' }
  | { type: 'TOGGLE_GHOST_ABOVE' }
  | { type: 'NORMALIZE_LAYERS' }
  | { type: 'LOAD_SKELETON'; level: SkeletonLevel }
  | { type: 'ROLLBACK' };
