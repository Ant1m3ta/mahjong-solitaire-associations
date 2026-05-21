import type {
  BoardSlot,
  Card,
  CategoryData,
  CategorySlot,
  GameState,
  LevelData,
} from '../../types';
import type { CardKind, SkeletonLevel } from '../types';

export interface SolverInput {
  initialState: GameState;
  uidByCellKey: Map<string, string>;
}

export class SolverInputError extends Error {}

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function buildSolverInput(skel: SkeletonLevel): SolverInput {
  if (skel.categories.length === 0) {
    throw new SolverInputError('No categories.');
  }

  const totalSimplesByLetter = new Map<string, number>();
  for (const c of skel.categories) totalSimplesByLetter.set(c.letter, c.simpleCards);

  const placedSimpleCountsByLetter = new Map<string, number>();
  for (const c of skel.board) {
    if (c.kind === 'simple') {
      placedSimpleCountsByLetter.set(c.letter, (placedSimpleCountsByLetter.get(c.letter) ?? 0) + 1);
    }
  }
  for (const c of skel.stock) {
    if (c.kind === 'simple') {
      placedSimpleCountsByLetter.set(c.letter, (placedSimpleCountsByLetter.get(c.letter) ?? 0) + 1);
    }
  }

  const categories: CategoryData[] = skel.categories.map((c) => ({
    categoryId: c.letter,
    wordsData: Array.from({ length: c.simpleCards }, (_, i) => ({ wordId: `${c.letter}_w${i}` })),
  }));

  let nextUid = 1;
  const mkUid = () => `c${nextUid++}`;

  const wordCursor = new Map<string, number>();
  function makeCard(letter: string, kind: CardKind): Card {
    if (!totalSimplesByLetter.has(letter)) {
      throw new SolverInputError(`Letter ${letter} placed but no category declares it.`);
    }
    if (kind === 'category') {
      return {
        uid: mkUid(),
        cardId: letter,
        category: letter,
        word: letter,
        isCategory: true,
      };
    }
    const cur = wordCursor.get(letter) ?? 0;
    wordCursor.set(letter, cur + 1);
    return {
      uid: mkUid(),
      cardId: `${letter}_w${cur}`,
      category: letter,
      word: `${letter}_w${cur}`,
      isCategory: false,
    };
  }

  const slotMap = new Map<string, BoardSlot>();
  const uidByCellKey = new Map<string, string>();

  const sortedBoard = skel.board.slice().sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return a.z - b.z;
  });

  for (const b of sortedBoard) {
    const card = makeCard(b.letter, b.kind);
    uidByCellKey.set(cellKey(b.x, b.y, b.z), card.uid);
    const key = `${b.x},${b.y}`;
    let slot = slotMap.get(key);
    if (!slot) {
      slot = { x: b.x, y: b.y, cards: [], dead: false, floorZ: b.z };
      slotMap.set(key, slot);
    } else if (b.z < slot.floorZ) {
      slot.floorZ = b.z;
    }
    slot.cards.push({ card, z: b.z, revealed: false });
  }

  for (const slot of slotMap.values()) {
    slot.cards.sort((a, b) => a.z - b.z);
    const topIdx = slot.cards.length - 1;
    slot.cards[topIdx] = { ...slot.cards[topIdx], revealed: true };
  }

  const stock = skel.stock.map((s) => makeCard(s.letter, s.kind));

  const categorySlots: CategorySlot[] = Array.from(
    { length: skel.slotsDefault },
    () => ({
      lockedCategory: null,
      displayedCard: null,
      cardsConsumed: 0,
    }),
  );

  const level: LevelData = {
    levelId: skel.levelId || 'solver',
    slotsDefault: skel.slotsDefault,
    movesLimit: -1,
    categories,
    stock: [],
    board: [],
  };

  const initialState: GameState = {
    level,
    stock,
    hand: null,
    categorySlots,
    boardSlots: Array.from(slotMap.values()),
    consumedSimple: [],
    movesUsed: 0,
    movesLimit: -1,
    bonusSlotUsed: true,
  };

  return { initialState, uidByCellKey };
}
