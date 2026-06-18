import imageCatsRaw from './catalog/image_categories.json';
import type { LevelData, WordData } from '../types';
import type { LevelFileEntry } from './save';
import { overridesForLevel } from './batchFill';

// The image-ready catalog: categories whose words all have PNGs in
// public/images. Derived from the card-illustration filenames, so each wordId
// is the snake token of the picture (e.g. "broadsword" → blades__broadsword.png).
export interface ImageCat {
  categoryId: string;
  wordsIds: string[];
}

const IMAGE_CATS: ImageCat[] = (imageCatsRaw as ImageCat[]).slice();
const IMG_BY_ID = new Map(IMAGE_CATS.map((c) => [c.categoryId, c]));
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function imageIdFor(categoryId: string, token: string): string {
  return `${categoryId}__${token}`;
}

export function prettyToken(token: string): string {
  return token.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// A random image category with at least `distinctWords` words, excluding any id
// already in use in the level (so two slots never collide on the same category).
export function pickImageCategory(distinctWords: number, exclude: Set<string>): ImageCat | null {
  const cands = IMAGE_CATS.filter(
    (c) => c.wordsIds.length >= distinctWords && !exclude.has(c.categoryId.toLowerCase()),
  );
  if (cands.length === 0) return null;
  return cands[Math.floor(Math.random() * cands.length)];
}

export interface ImageSlot {
  index: number; // position in level.categories
  letter: string; // stable display/override key
  originalCategoryId: string;
  categoryId: string; // current (swapped image category, or the original)
  distinctWords: number; // distinct words the slot needs to reskin 1:1
  isImage: boolean; // currently renders as pictures
  swapped: boolean; // user replaced this slot with an image category
  tokens: string[]; // current word tokens (image tokens, or original wordIds)
  ok: boolean;
  problem?: string;
}

export interface ImageRow {
  name: string;
  status: 'ok' | 'error';
  error?: string;
  slots: ImageSlot[];
  imageSlotCount: number;
  swapCount: number;
  hasProblem: boolean;
}

interface SwapResult {
  level: LevelData;
  slots: ImageSlot[];
}

// Surgical reskin: replace each selected category's id + word vocabulary with an
// image category's, mapping the slot's distinct words 1:1 onto picture tokens and
// rewriting every board/stock reference. The placement/match structure (including
// any word reuse across tiles) is preserved exactly — only the imagery changes.
function buildSwapResult(level: LevelData, swaps: Map<number, string>): SwapResult {
  const cats = level.categories;
  const origWords = cats.map((c) => c.wordsData.map((w) => w.wordId));
  const origIsImage = cats.map(
    (c) => c.wordsData.length > 0 && c.wordsData.every((w) => w.icon),
  );

  // Vocabulary the swapped words must avoid: every final category id plus the
  // words of every untouched category. Swapped slots add their picks as we go.
  const finalCatIds = cats.map((c, i) => (swaps.get(i) ?? c.categoryId));
  const used = new Set<string>();
  finalCatIds.forEach((id) => used.add(id.toLowerCase()));
  cats.forEach((_c, i) => {
    if (!swaps.has(i)) origWords[i].forEach((w) => used.add(w.toLowerCase()));
  });
  // A category id reused across two final slots is an ambiguous collision.
  const idCounts = new Map<string, number>();
  finalCatIds.forEach((id) => idCounts.set(id.toLowerCase(), (idCounts.get(id.toLowerCase()) ?? 0) + 1));

  const chosen = new Map<number, string[]>();
  const wordMap = new Map<string, string>(); // old wordId → new token (swapped slots)
  const catMap = new Map<string, string>(); // old categoryId → new categoryId
  const problem = new Map<number, string>();

  cats.forEach((c, i) => {
    if (!swaps.has(i)) return;
    const id = swaps.get(i)!;
    const cat = IMG_BY_ID.get(id);
    if (!cat) {
      problem.set(i, `unknown image category "${id}"`);
      return;
    }
    if ((idCounts.get(id.toLowerCase()) ?? 0) > 1) {
      problem.set(i, `category "${id}" used by another slot`);
    }
    const need = origWords[i].length;
    const tokens: string[] = [];
    for (const t of cat.wordsIds) {
      if (tokens.length >= need) break;
      if (used.has(t.toLowerCase())) continue;
      tokens.push(t);
      used.add(t.toLowerCase());
    }
    chosen.set(i, tokens);
    if (tokens.length < need && !problem.has(i)) {
      problem.set(i, `only ${tokens.length}/${need} unique image words available`);
    }
    catMap.set(c.categoryId, id);
    origWords[i].forEach((ow, k) => {
      if (k < tokens.length) wordMap.set(ow, tokens[k]);
    });
  });

  const categories = cats.map((c, i) => {
    if (!swaps.has(i)) return c;
    const id = swaps.get(i)!;
    const tokens = chosen.get(i) ?? [];
    const wordsData: WordData[] = tokens.map((t) => ({
      wordId: t,
      icon: true,
      imageId: imageIdFor(id, t),
    }));
    return { categoryId: id, wordsData };
  });

  const remap = (cardId: string): string => catMap.get(cardId) ?? wordMap.get(cardId) ?? cardId;
  const board = level.board.map((b) => ({ ...b, cardId: remap(b.cardId) }));
  const stock = level.stock.map(remap);

  const slots: ImageSlot[] = cats.map((c, i) => {
    const swapped = swaps.has(i);
    return {
      index: i,
      letter: LETTERS[i] ?? String(i),
      originalCategoryId: c.categoryId,
      categoryId: swapped ? swaps.get(i)! : c.categoryId,
      distinctWords: origWords[i].length,
      isImage: swapped ? true : origIsImage[i],
      swapped,
      tokens: swapped ? (chosen.get(i) ?? []) : origWords[i],
      ok: !problem.has(i),
      problem: problem.get(i),
    };
  });

  return { level: { ...level, categories, board, stock }, slots };
}

function swapsFromOverrides(level: LevelData, lvlOverrides: Record<string, string>): Map<number, string> {
  const swaps = new Map<number, string>();
  for (const [letter, id] of Object.entries(lvlOverrides)) {
    const idx = LETTERS.indexOf(letter);
    if (idx >= 0 && idx < level.categories.length) swaps.set(idx, id);
  }
  return swaps;
}

export function buildImagePlan(
  entries: LevelFileEntry[],
  overrides: Record<string, string>,
): ImageRow[] {
  return entries.map((entry) => {
    try {
      const swaps = swapsFromOverrides(entry.level, overridesForLevel(overrides, entry.name));
      const { slots } = buildSwapResult(entry.level, swaps);
      return {
        name: entry.name,
        status: 'ok' as const,
        slots,
        imageSlotCount: slots.filter((s) => s.isImage).length,
        swapCount: slots.filter((s) => s.swapped).length,
        hasProblem: slots.some((s) => !s.ok),
      };
    } catch (e) {
      return {
        name: entry.name,
        status: 'error' as const,
        error: e instanceof Error ? e.message : String(e),
        slots: [],
        imageSlotCount: 0,
        swapCount: 0,
        hasProblem: false,
      };
    }
  });
}

// Produce the reskinned level JSON for saving. Throws if any swap is unresolved.
export function resolveImageLevel(entry: LevelFileEntry, overrides: Record<string, string>): LevelData {
  const swaps = swapsFromOverrides(entry.level, overridesForLevel(overrides, entry.name));
  if (swaps.size === 0) throw new Error('no categories swapped');
  const { level, slots } = buildSwapResult(entry.level, swaps);
  const bad = slots.find((s) => !s.ok);
  if (bad) throw new Error(`${bad.letter}: ${bad.problem}`);
  return level;
}
