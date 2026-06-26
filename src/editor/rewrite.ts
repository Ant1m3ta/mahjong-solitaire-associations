import type { CategoryData, LevelData, WordData } from '../types';
import { makeWordData, placeholderWord, maxPlaceholderN } from './imageWords';

export class RewriteError extends Error {}

interface LevelIndex {
  // categoryId -> category index, wordId -> owning category index.
  catIndexById: Map<string, number>;
  catIndexByWord: Map<string, number>;
  // Number of simple (non-category) board+stock tiles per category index.
  simpleCounts: number[];
  classify: (cardId: string) => { index: number; kind: 'category' | 'simple' };
}

// Resolve every id in the level to a category index, enforcing the game's
// invariants (words globally unique; every board/stock id resolves). Throws
// RewriteError on violation — the same checks unfill made, minus the skeleton.
export function indexLevel(level: LevelData): LevelIndex {
  const catIndexById = new Map<string, number>();
  level.categories.forEach((c, i) => {
    if (catIndexById.has(c.categoryId)) {
      throw new RewriteError(`duplicate categoryId "${c.categoryId}"`);
    }
    catIndexById.set(c.categoryId, i);
  });

  const catIndexByWord = new Map<string, number>();
  level.categories.forEach((c, i) => {
    for (const w of c.wordsData) {
      const prev = catIndexByWord.get(w.wordId);
      // A repeat within the same category is harmless (it resolves to that
      // category either way); only a cross-category collision is ambiguous.
      if (prev !== undefined && prev !== i) {
        throw new RewriteError(`word "${w.wordId}" appears in multiple categories; ambiguous.`);
      }
      catIndexByWord.set(w.wordId, i);
    }
  });

  const classify = (cardId: string): { index: number; kind: 'category' | 'simple' } => {
    const ci = catIndexById.get(cardId);
    if (ci !== undefined) return { index: ci, kind: 'category' };
    const wi = catIndexByWord.get(cardId);
    if (wi !== undefined) return { index: wi, kind: 'simple' };
    throw new RewriteError(`card "${cardId}" is neither a categoryId nor a known wordId.`);
  };

  const simpleCounts = new Array<number>(level.categories.length).fill(0);
  for (const b of level.board) {
    const { index, kind } = classify(b.cardId);
    if (kind === 'simple') simpleCounts[index]++;
  }
  for (const id of level.stock) {
    const { index, kind } = classify(id);
    if (kind === 'simple') simpleCounts[index]++;
  }

  return { catIndexById, catIndexByWord, simpleCounts, classify };
}

// Simple (non-category) board+stock tile count per category index.
export function simpleTileCounts(level: LevelData): number[] {
  return indexLevel(level).simpleCounts;
}

export interface CategoryRewrite {
  index: number; // which category in level.categories to rewrite
  categoryId: string; // its new id
  words: string[]; // chosen words; padded with placeholders to the tile count
}

// Rewrite specific categories of a level in place: replace each named category's
// id + words and remap exactly its board/stock cardIds. Untouched categories and
// their cards are returned verbatim — the placement/match structure is preserved
// (the imageSwap.ts pattern, for text words). Word↔tile assignment matches the
// skeleton fill's cursor (board then stock), so output equals the old
// unfill→fillSkeleton path for the same chosen words.
export function rewriteCategories(
  level: LevelData,
  rewrites: CategoryRewrite[],
  opts: { textOnly?: boolean } = {},
): LevelData {
  if (rewrites.length === 0) return level;
  const { classify, simpleCounts } = indexLevel(level);
  const byIndex = new Map(rewrites.map((r) => [r.index, r]));
  const textOnly = opts.textOnly ?? false;

  // Continue placeholder numbering past placeholders in UNTOUCHED categories
  // only, so padded gaps never collide with kept ones — while rewritten
  // categories renumber from scratch (matching a full fill of just those).
  const untouchedWordIds = level.categories.flatMap((c, i) =>
    byIndex.has(i) ? [] : c.wordsData.map((w) => w.wordId),
  );
  let ph = maxPlaceholderN(untouchedWordIds);

  // New wordsData per rewritten index: the chosen words, padded with flagged
  // placeholders up to the category's tile count. The cardId a tile gets is the
  // wordData's wordId, so the two can't disagree.
  const newWords = new Map<number, WordData[]>();
  for (const r of rewrites) {
    const count = simpleCounts[r.index];
    const wordsData: WordData[] = [];
    for (let k = 0; k < count; k++) {
      const missing = k >= r.words.length;
      const word = missing ? placeholderWord(++ph) : r.words[k];
      wordsData.push(makeWordData(r.categoryId, word, missing, textOnly));
    }
    newWords.set(r.index, wordsData);
  }

  const categories: CategoryData[] = level.categories.map((c, i) => {
    const r = byIndex.get(i);
    if (!r) return c;
    const wordsData = newWords.get(i)!;
    const cat: CategoryData = { categoryId: r.categoryId, wordsData };
    if (wordsData.some((w) => w.missing)) cat.incomplete = true;
    return cat;
  });

  // Hand each rewritten category's tiles its new wordIds in board-then-stock
  // order; untouched cards keep their id.
  const cursor = new Map<number, number>();
  const remap = (cardId: string): string => {
    const { index, kind } = classify(cardId);
    const r = byIndex.get(index);
    if (!r) return cardId;
    if (kind === 'category') return r.categoryId;
    const wordsData = newWords.get(index)!;
    const k = cursor.get(index) ?? 0;
    cursor.set(index, k + 1);
    return wordsData[k].wordId;
  };

  const board = level.board.map((b) => ({ ...b, cardId: remap(b.cardId) }));
  const stock = level.stock.map(remap);

  return { ...level, categories, board, stock };
}
