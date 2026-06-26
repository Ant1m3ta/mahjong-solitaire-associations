import type { CategoryData, LevelData } from '../types';
import type { CardKind } from './types';
import { rewriteCategories, type CategoryRewrite } from './rewrite';
import { makeWordData, placeholderWord, maxPlaceholderN } from './imageWords';
import { pools } from './fill';

// LevelData-direct editor operations. The editor's working state IS a LevelData;
// these helpers do what the old skeleton + fillSkeleton round-trip did, but as
// surgical in-place rewrites (built on rewrite.ts). A category with no real
// theme yet is a PLACEHOLDER category — a synthetic id + `(needs word N)` words
// living in the level itself — resolved to a real one on pin/fill, or randomly
// at save (resolvePlaceholders), mirroring the old deferred fill.

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// A category's display label is derived from its position, not stored.
export const displayLetter = (index: number): string =>
  index >= 0 && index < LETTERS.length ? LETTERS[index] : '?';

export const isPlaceholderCategory = (categoryId: string): boolean =>
  categoryId.startsWith('__cat');

export function emptyLevel(): LevelData {
  return { levelId: 'editor-1', slotsDefault: 4, movesLimit: 100, categories: [], board: [], stock: [] };
}

// cardId -> { category index, kind }, tolerant (index -1 when unresolved — the
// editor never produces that, but rendering must not throw on a transient).
export type ResolveCard = (cardId: string) => { index: number; kind: CardKind };

export function buildResolver(level: LevelData): ResolveCard {
  const byId = new Map<string, number>();
  const byWord = new Map<string, number>();
  level.categories.forEach((c, i) => {
    byId.set(c.categoryId, i);
    for (const w of c.wordsData) if (!byWord.has(w.wordId)) byWord.set(w.wordId, i);
  });
  return (cardId: string) => {
    const ci = byId.get(cardId);
    if (ci !== undefined) return { index: ci, kind: 'category' };
    return { index: byWord.get(cardId) ?? -1, kind: 'simple' };
  };
}

export function categoryIndexById(level: LevelData, categoryId: string): number {
  return level.categories.findIndex((c) => c.categoryId === categoryId);
}

// Simple (non-category) board+stock tile count per category index.
export function simpleCounts(level: LevelData): number[] {
  const resolve = buildResolver(level);
  const counts = new Array<number>(level.categories.length).fill(0);
  for (const b of level.board) {
    const r = resolve(b.cardId);
    if (r.kind === 'simple' && r.index >= 0) counts[r.index]++;
  }
  for (const id of level.stock) {
    const r = resolve(id);
    if (r.kind === 'simple' && r.index >= 0) counts[r.index]++;
  }
  return counts;
}

const allWordIds = (level: LevelData): string[] =>
  level.categories.flatMap((c) => c.wordsData.map((w) => w.wordId));

// A placeholder category id not used by any current category.
function freePlaceholderId(level: LevelData): string {
  const used = new Set(level.categories.map((c) => c.categoryId));
  let n = 1;
  while (used.has(`__cat${n}`)) n++;
  return `__cat${n}`;
}

// Append a new placeholder category of `size` simples: the category (placeholder
// words) plus its stock entries (1 category card + `size` simple cards). Returns
// the new level and the new category's id (for selecting it as the brush).
export function addPlaceholderCategory(level: LevelData, size: number): { level: LevelData; categoryId: string } {
  const categoryId = freePlaceholderId(level);
  let ph = maxPlaceholderN(allWordIds(level));
  const wordsData = Array.from({ length: size }, () =>
    makeWordData(categoryId, placeholderWord(++ph), true, false),
  );
  const category: CategoryData = { categoryId, wordsData };
  if (size > 0) category.incomplete = true;
  const stock = [...level.stock, categoryId, ...wordsData.map((w) => w.wordId)];
  return { level: { ...level, categories: [...level.categories, category], stock }, categoryId };
}

// Up to `count` catalog words for categoryId, skipping words used by OTHER
// categories and any category name (single-slot dedup, like computeAssignments).
export function pickCatalogWords(
  level: LevelData,
  exceptIndex: number,
  categoryId: string,
  count: number,
): string[] {
  const used = new Set<string>();
  const reserved = new Set<string>([categoryId.toLowerCase()]);
  level.categories.forEach((c, i) => {
    reserved.add(c.categoryId.toLowerCase());
    if (i === exceptIndex) return;
    for (const w of c.wordsData) used.add(w.wordId.toLowerCase());
  });
  const out: string[] = [];
  for (const w of pools().byId.get(categoryId)?.wordsIds ?? []) {
    if (out.length >= count) break;
    const k = w.toLowerCase();
    if (used.has(k) || reserved.has(k)) continue;
    out.push(w);
  }
  return out;
}

// Rewrite category[index] to a concrete categoryId. With `words` supplied (range
// picker / basics) they are used verbatim; otherwise catalog words are chosen.
export function setCategory(level: LevelData, index: number, categoryId: string, words?: string[]): LevelData {
  const count = simpleCounts(level)[index];
  const chosen = words ?? pickCatalogWords(level, index, categoryId, count);
  return rewriteCategories(level, [{ index, categoryId, words: chosen }]);
}

// Revert category[index] to a fresh placeholder (the "random / unpinned" state).
export function unsetCategory(level: LevelData, index: number): LevelData {
  return rewriteCategories(level, [{ index, categoryId: freePlaceholderId(level), words: [] }]);
}

// Add one simple card to category[index]: a real catalog word when the category
// is themed and one is free, else a flagged placeholder. Returns the new level
// and the new card's id (which the caller pushes onto the stock).
export function addSimpleWord(level: LevelData, index: number): { level: LevelData; cardId: string } {
  const cat = level.categories[index];
  const existing = new Set(cat.wordsData.map((w) => w.wordId.toLowerCase()));
  const usedElsewhere = new Set<string>();
  level.categories.forEach((c, i) => {
    if (i === index) return;
    for (const w of c.wordsData) usedElsewhere.add(w.wordId.toLowerCase());
  });

  let word: string | null = null;
  if (!isPlaceholderCategory(cat.categoryId)) {
    for (const w of pools().byId.get(cat.categoryId)?.wordsIds ?? []) {
      const k = w.toLowerCase();
      if (existing.has(k) || usedElsewhere.has(k)) continue;
      word = w;
      break;
    }
  }
  const missing = word === null;
  if (word === null) word = placeholderWord(maxPlaceholderN(allWordIds(level)) + 1);
  const wd = makeWordData(cat.categoryId, word, missing, false);

  const categories = level.categories.map((c, i) =>
    i === index
      ? { ...c, wordsData: [...c.wordsData, wd], ...(missing ? { incomplete: true } : {}) }
      : c,
  );
  return { level: { ...level, categories }, cardId: wd.wordId };
}

// Remove one of category[index]'s simple cards that currently sits in the STOCK
// (never the board). Returns null when every simple is on the board (the caller
// surfaces "remove one from the board first"). The matching word is dropped from
// wordsData unless another tile still references it.
export function removeSimpleFromStock(level: LevelData, index: number): LevelData | null {
  const resolve = buildResolver(level);
  let stockIdx = -1;
  for (let i = level.stock.length - 1; i >= 0; i--) {
    const r = resolve(level.stock[i]);
    if (r.index === index && r.kind === 'simple') {
      stockIdx = i;
      break;
    }
  }
  if (stockIdx < 0) return null;

  const removedId = level.stock[stockIdx];
  const stock = level.stock.filter((_, i) => i !== stockIdx);
  const stillReferenced =
    stock.includes(removedId) || level.board.some((b) => b.cardId === removedId);
  const categories = stillReferenced
    ? level.categories
    : level.categories.map((c, i) => {
        if (i !== index) return c;
        let dropped = false;
        const wordsData = c.wordsData.filter((w) => {
          if (!dropped && w.wordId === removedId) {
            dropped = true;
            return false;
          }
          return true;
        });
        return { ...c, wordsData };
      });
  return { ...level, categories, board: level.board, stock };
}

// Save-time fill: replace every still-placeholder category with a random unused
// catalog category that has enough words (what the old fillSkeleton did for
// unpinned categories). Real categories are untouched. Categories with no
// candidate are left as placeholders so the level still saves (Fix resolves them).
export function resolvePlaceholders(level: LevelData): LevelData {
  const counts = simpleCounts(level);
  const usedCats = new Set<string>();
  const usedWords = new Set<string>();
  level.categories.forEach((c) => {
    if (isPlaceholderCategory(c.categoryId)) return;
    usedCats.add(c.categoryId.toLowerCase());
    for (const w of c.wordsData) usedWords.add(w.wordId.toLowerCase());
  });

  const { all } = pools();
  const rewrites: CategoryRewrite[] = [];
  level.categories.forEach((c, index) => {
    if (!isPlaceholderCategory(c.categoryId)) return;
    const need = counts[index];
    const candidates = all.filter(
      (p) => p.wordsIds.length >= need && !usedCats.has(p.categoryId.toLowerCase()),
    );
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    usedCats.add(pick.categoryId.toLowerCase());
    const words: string[] = [];
    for (const w of pick.wordsIds) {
      if (words.length >= need) break;
      const k = w.toLowerCase();
      if (usedWords.has(k) || k === pick.categoryId.toLowerCase()) continue;
      words.push(w);
      usedWords.add(k);
    }
    rewrites.push({ index, categoryId: pick.categoryId, words });
  });
  return rewriteCategories(level, rewrites);
}
