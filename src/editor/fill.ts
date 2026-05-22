import wordsCatalog from './catalog/words.json';
import { AVAILABLE_IMAGES } from './catalog/images';
import { BASIC_FILL } from './basics';
import type { SkeletonCategory, SkeletonLevel } from './types';
import type { LevelData } from '../types';

interface RawCat {
  categoryId: string;
  wordsIds: string[];
}

interface Usable {
  categoryId: string;
  wordsIds: string[];
}

export class FillError extends Error {}

function toSnake(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function imageBasename(categoryId: string, wordId: string): string {
  return `${toSnake(categoryId)}__${toSnake(wordId)}`;
}

function hasImage(categoryId: string, wordId: string): boolean {
  return AVAILABLE_IMAGES.has(imageBasename(categoryId, wordId));
}

export function categoryKind(categoryId: string, wordsIds: string[]): 'icon' | 'text' | 'mixed' {
  let iconCount = 0;
  for (const w of wordsIds) if (hasImage(categoryId, w)) iconCount++;
  if (iconCount === 0) return 'text';
  if (iconCount === wordsIds.length) return 'icon';
  return 'mixed';
}

let cachedPools: { all: Usable[]; byId: Map<string, Usable> } | null = null;

export function pools() {
  if (!cachedPools) {
    const all: Usable[] = (wordsCatalog as RawCat[]).map((c) => ({
      categoryId: c.categoryId,
      wordsIds: c.wordsIds.slice(),
    }));
    const byId = new Map<string, Usable>();
    for (const c of all) byId.set(c.categoryId, c);
    for (const b of BASIC_FILL) {
      const existing = byId.get(b.categoryId);
      if (existing) {
        const seen = new Set(existing.wordsIds.map((w) => w.toLowerCase()));
        for (const w of b.words) if (!seen.has(w.toLowerCase())) existing.wordsIds.push(w);
      } else {
        const fresh: Usable = { categoryId: b.categoryId, wordsIds: b.words.slice() };
        all.push(fresh);
        byId.set(b.categoryId, fresh);
      }
    }
    cachedPools = { all, byId };
  }
  return cachedPools;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickReal(skel: SkeletonCategory, basePool: Usable[], byId: Map<string, Usable>, used: Set<string>): Usable {
  const minWords = skel.simpleCards;
  if (skel.pinnedCategoryId) {
    const pinned = byId.get(skel.pinnedCategoryId);
    if (!pinned) {
      throw new FillError(
        `Letter ${skel.letter}: pinned category "${skel.pinnedCategoryId}" not in pool.`,
      );
    }
    if (pinned.wordsIds.length < minWords) {
      throw new FillError(
        `Letter ${skel.letter}: pinned "${skel.pinnedCategoryId}" has ${pinned.wordsIds.length} words, need ${minWords}.`,
      );
    }
    used.add(pinned.categoryId);
    return pinned;
  }
  const candidates = basePool.filter(
    (c) => !used.has(c.categoryId) && c.wordsIds.length >= minWords,
  );
  if (candidates.length === 0) {
    throw new FillError(
      `Letter ${skel.letter}: no category with ≥${minWords} words available.`,
    );
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  used.add(pick.categoryId);
  return pick;
}

function wordData(categoryId: string, word: string) {
  return hasImage(categoryId, word)
    ? { wordId: toSnake(word), icon: true, imageId: imageBasename(categoryId, word) }
    : { wordId: word };
}

export function fillSkeleton(skel: SkeletonLevel): LevelData {
  const { all, byId } = pools();
  const used = new Set<string>();
  const map = new Map<string, { real: Usable; assigned: string[] }>();

  for (const cat of skel.categories) {
    const real = pickReal(cat, all, byId, used);
    const assigned = shuffleInPlace(real.wordsIds.slice()).slice(0, cat.simpleCards);
    map.set(cat.letter, { real, assigned });
  }

  const categories: LevelData['categories'] = [];
  for (const cat of skel.categories) {
    const entry = map.get(cat.letter)!;
    const wordsData = entry.assigned.map((w) => wordData(entry.real.categoryId, w));
    categories.push({ categoryId: entry.real.categoryId, wordsData });
  }

  const wordCursor = new Map<string, number>();
  function refFor(letter: string, kind: 'category' | 'simple'): string {
    const entry = map.get(letter);
    if (!entry) throw new FillError(`Letter ${letter} has no fill mapping.`);
    if (kind === 'category') return entry.real.categoryId;
    const cursor = wordCursor.get(letter) ?? 0;
    if (cursor >= entry.assigned.length) {
      throw new FillError(`Letter ${letter}: more simple placements than words assigned.`);
    }
    const w = entry.assigned[cursor];
    wordCursor.set(letter, cursor + 1);
    return hasImage(entry.real.categoryId, w) ? toSnake(w) : w;
  }

  const board: LevelData['board'] = skel.board.map((b) => ({
    x: b.x,
    y: b.y,
    z: b.z,
    cardId: refFor(b.letter, b.kind),
  }));
  const stock: LevelData['stock'] = skel.stock.map((s) => refFor(s.letter, s.kind));

  return {
    levelId: skel.levelId || 'editor-out',
    slotsDefault: skel.slotsDefault,
    movesLimit: skel.movesLimit,
    categories,
    board,
    stock,
  };
}
