import type { LevelData } from '../types';

export type CardKind = 'category' | 'simple';

// Bounding-box anchor for the board-align grid: start = left/top edge,
// end = right/bottom edge, center = midpoint of the 5×5 outline.
export type AlignAnchor = 'start' | 'center' | 'end';

// A category assignment from the range picker / basics: which category slot
// (by index), the real categoryId to give it, and the exact words to use.
export interface RangeAssignment {
  index: number;
  categoryId: string;
  words: string[];
}

// The brush selects a category by its (stable) id plus which kind of card to
// place. The category's display letter is derived from its position.
export interface BrushState {
  categoryId: string | null;
  kind: CardKind;
}

export interface HistoryEntry {
  level: LevelData;
  currentLayer: number;
}

export interface PickedCard {
  x: number;
  y: number;
  z: number;
}

export interface EditorState {
  level: LevelData;
  history: HistoryEntry[];
  brush: BrushState;
  currentLayer: number;
  // Layer peeking: by default the canvas shows one layer below and one above the
  // editing layer. These extend that to every layer in each direction.
  showAllBelow: boolean;
  showAllAbove: boolean;
  gridOutline: boolean;
  // Overlay each board card with its optimal-solver move number. Off by default.
  showMoveNumbers: boolean;
  eraseMode: boolean;
  moveMode: boolean;
  swapMode: boolean;
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
  | { type: 'REMOVE_CATEGORY'; index: number }
  // Theme category[index] to a real categoryId (catalog words), or null to
  // revert it to a fresh placeholder ("random / unpinned").
  | { type: 'SET_PINNED_CATEGORY'; index: number; categoryId: string | null }
  | { type: 'APPLY_CATEGORY_RANGE'; assignments: RangeAssignment[] }
  | { type: 'FILL_BASIC' }
  | { type: 'FILL_WORDS' }
  | { type: 'CLEAR_PINS' }
  | { type: 'INC_SIMPLE'; index: number }
  | { type: 'DEC_SIMPLE'; index: number }
  | { type: 'PLACE_BOARD'; x: number; y: number; z: number; categoryId: string; cardKind: CardKind }
  | { type: 'REMOVE_BOARD'; x: number; y: number; z: number }
  | { type: 'REORDER_STOCK'; from: number; to: number }
  | { type: 'PROMOTE_STOCK'; index: number }
  | { type: 'APPLY_STOCK_ORDER'; stock: string[] }
  | { type: 'DELETE_STOCK'; index: number }
  | { type: 'SET_BRUSH_CATEGORY'; categoryId: string | null }
  | { type: 'SET_BRUSH_KIND'; kind: CardKind }
  | { type: 'TOGGLE_ERASE' }
  | { type: 'TOGGLE_MOVE' }
  | { type: 'TOGGLE_SWAP' }
  | {
      type: 'SWAP_LOCK';
      target:
        | { where: 'board'; x: number; y: number; z: number }
        | { where: 'stock'; index: number };
    }
  | { type: 'PICK_CARD'; x: number; y: number; z: number }
  | { type: 'CANCEL_PICK' }
  | { type: 'MOVE_BOARD'; from: PickedCard; to: PickedCard }
  | { type: 'SET_LAYER'; z: number }
  | { type: 'TOGGLE_SHOW_ALL_BELOW' }
  | { type: 'TOGGLE_SHOW_ALL_ABOVE' }
  | { type: 'TOGGLE_GRID_OUTLINE' }
  | { type: 'TOGGLE_MOVE_NUMBERS' }
  | { type: 'TOGGLE_STOCK_ADVANCE' }
  | { type: 'SET_DEFAULT_NEW_CATEGORY_SIZE'; size: number }
  | { type: 'SHUFFLE_STOCK' }
  | { type: 'SHUFFLE_BOARD' }
  | { type: 'NORMALIZE_LAYERS' }
  | { type: 'ALIGN_BOARD'; anchorX: AlignAnchor; anchorY: AlignAnchor }
  | { type: 'LOAD_LEVEL'; level: LevelData }
  | { type: 'ROLLBACK' };
