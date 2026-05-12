export interface Card {
  uid: string;
  cardId: string;
  category: string;
  word: string;
  isCategory: boolean;
  isIcon?: boolean;
  imageId?: string;
}

export interface BoardCardEntry {
  card: Card;
  z: number;
  // True once the card has ever been the slot's exposed top (initial top at
  // level load, or surfaced by removing the card above). Chains only include
  // revealed entries — pre-stacked level data does not auto-form a chain.
  revealed: boolean;
}

export interface BoardSlot {
  x: number;
  y: number;
  cards: BoardCardEntry[];
  dead: boolean;
  floorZ: number;
}

export interface CategorySlot {
  lockedCategory: string | null;
  displayedCard: Card | null;
  cardsConsumed: number;
}

export interface GameState {
  level: LevelData;
  stock: Card[];
  hand: Card | null;
  categorySlots: CategorySlot[];
  boardSlots: BoardSlot[];
  consumedSimple: Card[];
  movesUsed: number;
  movesLimit: number;
  bonusSlotUsed: boolean;
}

export interface LevelData {
  levelId: string;
  slotsDefault: number;
  movesLimit: number;
  categories: CategoryData[];
  stock: string[];
  board: BoardCardData[];
}

export interface CategoryData {
  categoryId: string;
  wordsData: WordData[];
}

export interface WordData {
  wordId: string;
  icon?: boolean;
  imageId?: string;
}

export interface BoardCardData {
  x: number;
  y: number;
  z: number;
  cardId: string;
}

export type Action =
  | { type: 'DRAW' }
  | { type: 'HAND_TO_CATEGORY'; slotIndex: number }
  | { type: 'HAND_TO_BOARD'; to: { x: number; y: number } }
  | { type: 'BOARD_TO_CATEGORY'; from: { x: number; y: number }; slotIndex: number }
  | { type: 'BOARD_TO_BOARD'; from: { x: number; y: number }; to: { x: number; y: number } };

export type AppAction =
  | Action
  | { type: 'ROLLBACK' }
  | { type: 'RESET'; level: LevelData }
  | { type: 'ADD_BONUS_SLOT' }
  | { type: 'SHUFFLE' };

export type Outcome = 'playing' | 'won' | 'lost';

export interface AppState {
  state: GameState;
  history: GameState[];
  outcome: Outcome;
  lastError: string | null;
}
