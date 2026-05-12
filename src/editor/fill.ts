import iconsCatalog from './catalog/icons.json';
import wordsCatalog from './catalog/words.json';
import { AVAILABLE_IMAGES } from './catalog/images';
import type { SkeletonCategory, SkeletonLevel } from './types';
import type { LevelData } from '../types';

interface RawCat {
  categoryId: string;
  wordsIds: string[];
}

type UsableKind = 'icon' | 'text';

interface Usable {
  categoryId: string;
  wordsIds: string[];
  kind: UsableKind;
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

let cachedPools: { icon: Usable[]; text: Usable[] } | null = null;

function pools() {
  if (!cachedPools) {
    const icon: Usable[] = (iconsCatalog as RawCat[])
      .map((c) => ({
        categoryId: c.categoryId,
        wordsIds: c.wordsIds.filter((w) => AVAILABLE_IMAGES.has(imageBasename(c.categoryId, w))),
        kind: 'icon' as const,
      }))
      .filter((c) => c.wordsIds.length > 0);
    const text: Usable[] = (wordsCatalog as RawCat[]).map((c) => ({
      categoryId: c.categoryId,
      wordsIds: c.wordsIds,
      kind: 'text' as const,
    }));
    cachedPools = { icon, text };
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

function pickReal(skel: SkeletonCategory, basePool: Usable[], used: Set<string>): Usable {
  const minWords = skel.simpleCards;
  if (skel.pinnedCategoryId) {
    const pinned = basePool.find((c) => c.categoryId === skel.pinnedCategoryId);
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
      `Letter ${skel.letter}: no ${skel.kind} category with ≥${minWords} words available.`,
    );
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  used.add(pick.categoryId);
  return pick;
}

export function fillSkeleton(skel: SkeletonLevel): LevelData {
  const { icon, text } = pools();
  const used = new Set<string>();
  const map = new Map<string, { real: Usable; assigned: string[] }>();

  for (const cat of skel.categories) {
    const basePool: Usable[] = cat.kind === 'icon' ? icon : text;
    const real = pickReal(cat, basePool, used);
    const assigned = shuffleInPlace(real.wordsIds.slice()).slice(0, cat.simpleCards);
    map.set(cat.letter, { real, assigned });
  }

  const categories: LevelData['categories'] = [];
  for (const cat of skel.categories) {
    const entry = map.get(cat.letter)!;
    const wordsData = entry.assigned.map((w) =>
      entry.real.kind === 'icon'
        ? { wordId: toSnake(w), icon: true, imageId: imageBasename(entry.real.categoryId, w) }
        : { wordId: w },
    );
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
    return entry.real.kind === 'icon' ? toSnake(w) : w;
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
