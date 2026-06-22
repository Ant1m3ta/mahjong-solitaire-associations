import imageCatsRaw from './catalog/image_categories.json';
import { AVAILABLE_IMAGES } from './catalog/images';
import { pools } from './fill';
import type { LevelData, WordData } from '../types';
import type { LevelFileEntry } from './save';
import { overridesForLevel } from './batchFill';

// Sentinel override value meaning "roll this slot back from pictures to text
// words" (the reverse of an image swap). Cannot collide with a real categoryId.
export const TO_WORDS = '__to_words__';

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

// Image-catalog ids are snake_case; level category ids are often TitleCase
// ("Birds"). Normalize before looking a category up in the catalog.
function normId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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

// The category's OWN image theme, if it exists in the catalog with enough
// pictures — used to show a slot as its own pictures (keeping the category).
// Matches by normalized name, so a level's "Birds" finds the "birds" set.
export function ownImageCategory(categoryId: string, distinctWords: number): ImageCat | null {
  const c = IMG_BY_ID.get(normId(categoryId));
  return c && c.wordsIds.length >= distinctWords ? c : null;
}

// Text-word catalog keyed by normalized name, so an imaged "birds" finds the
// "Birds" word list when rolling back to words.
let TEXT_BY_NORM: Map<string, { categoryId: string; wordsIds: string[] }> | null = null;
function textCatFor(categoryId: string): { categoryId: string; wordsIds: string[] } | null {
  if (!TEXT_BY_NORM) {
    TEXT_BY_NORM = new Map();
    for (const c of pools().all) {
      const k = normId(c.categoryId);
      if (!TEXT_BY_NORM.has(k)) TEXT_BY_NORM.set(k, c);
    }
  }
  return TEXT_BY_NORM.get(normId(categoryId)) ?? null;
}

// How many text words are available to roll a category back to words (0 = none).
export function rollbackWordCount(categoryId: string): number {
  return textCatFor(categoryId)?.wordsIds.length ?? 0;
}

// How many pictures the category's own theme has (0 if it has none) — for the
// per-category availability badge, independent of how many the slot needs.
export function ownImageTokenCount(categoryId: string): number {
  return IMG_BY_ID.get(normId(categoryId))?.wordsIds.length ?? 0;
}

// All image categories with at least `n` pictures — backs the manual picker.
export function imageCatsWithAtLeast(n: number): ImageCat[] {
  return IMAGE_CATS.filter((c) => c.wordsIds.length >= n);
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
  imageIds: string[]; // resolved image keys to render (empty for text slots)
  stale: boolean; // an image slot whose pictures are missing from public/images
  ownImageCount: number; // pictures the slot's own category theme has (0 if none)
  rollbackWords: number; // text words available to roll this category back to words
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
  staleCount: number;
  ownReadyCount: number; // categories that have enough of their own pictures
  hasProblem: boolean;
}

interface SwapResult {
  level: LevelData;
  slots: ImageSlot[];
}

// Surgical reskin: replace each selected category's id + word vocabulary, mapping
// the slot's distinct words 1:1 onto the target's (picture tokens for an image
// swap, or text words for a TO_WORDS rollback) and rewriting every board/stock
// reference. The placement/match structure (including word reuse across tiles)
// is preserved exactly — only the imagery/vocabulary changes.
type Resolved =
  | { kind: 'image'; catId: string; tokens: string[] }
  | { kind: 'words'; catId: string; words: string[] };

function buildSwapResult(level: LevelData, swaps: Map<number, string>): SwapResult {
  const cats = level.categories;
  const origWords = cats.map((c) => c.wordsData.map((w) => w.wordId));
  const origImageIds = cats.map((c) => c.wordsData.map((w) => w.imageId ?? ''));
  const origIsImage = cats.map(
    (c) => c.wordsData.length > 0 && c.wordsData.every((w) => w.icon),
  );

  const problem = new Map<number, string>();

  // Resolve each swapped slot's TARGET category id first (image cat id, or the
  // matching text cat id for a rollback) — needed for the collision check below.
  const targetId = new Map<number, string>();
  cats.forEach((c, i) => {
    if (!swaps.has(i)) return;
    const ov = swaps.get(i)!;
    if (ov === TO_WORDS) {
      const tc = textCatFor(c.categoryId);
      if (!tc) problem.set(i, `no words found for "${c.categoryId}"`);
      else targetId.set(i, tc.categoryId);
    } else if (!IMG_BY_ID.get(ov)) {
      problem.set(i, `unknown image category "${ov}"`);
    } else {
      targetId.set(i, ov);
    }
  });

  const finalCatIds = cats.map((c, i) => targetId.get(i) ?? c.categoryId);
  // A category id reused across two final slots is an ambiguous collision.
  const idCounts = new Map<string, number>();
  finalCatIds.forEach((id) => idCounts.set(id.toLowerCase(), (idCounts.get(id.toLowerCase()) ?? 0) + 1));

  // Vocabulary already taken (final cat ids + words of untouched slots); rollback
  // text words must avoid it to keep every cardId unique. Image tokens are
  // namespaced so they can't collide, but adding them is harmless.
  const used = new Set<string>();
  finalCatIds.forEach((id) => used.add(id.toLowerCase()));
  cats.forEach((_c, i) => {
    if (!swaps.has(i)) origWords[i].forEach((w) => used.add(w.toLowerCase()));
  });

  const resolved = new Map<number, Resolved>();
  const wordMap = new Map<string, string>(); // old wordId → new wordId/token
  const catMap = new Map<string, string>(); // old categoryId → new categoryId

  cats.forEach((c, i) => {
    if (!swaps.has(i) || problem.has(i)) return;
    const tid = targetId.get(i)!;
    if ((idCounts.get(tid.toLowerCase()) ?? 0) > 1) problem.set(i, `category "${tid}" used by another slot`);
    const need = origWords[i].length;
    catMap.set(c.categoryId, tid);

    if (swaps.get(i) === TO_WORDS) {
      const tc = textCatFor(c.categoryId)!;
      const words: string[] = [];
      for (const w of tc.wordsIds) {
        if (words.length >= need) break;
        if (used.has(w.toLowerCase())) continue;
        words.push(w);
        used.add(w.toLowerCase());
      }
      if (words.length < need && !problem.has(i)) {
        problem.set(i, `only ${words.length}/${need} unique words available`);
      }
      resolved.set(i, { kind: 'words', catId: tid, words });
      origWords[i].forEach((ow, k) => {
        if (k < words.length) wordMap.set(ow, words[k]);
      });
    } else {
      const tokens = IMG_BY_ID.get(tid)!.wordsIds.slice(0, need);
      if (tokens.length < need && !problem.has(i)) {
        problem.set(i, `only ${tokens.length}/${need} pictures available`);
      }
      resolved.set(i, { kind: 'image', catId: tid, tokens });
      origWords[i].forEach((ow, k) => {
        if (k < tokens.length) wordMap.set(ow, imageIdFor(tid, tokens[k]));
      });
    }
  });

  const categories = cats.map((c, i) => {
    const r = resolved.get(i);
    if (!r) return c;
    const wordsData: WordData[] =
      r.kind === 'image'
        ? r.tokens.map((t) => ({ wordId: imageIdFor(r.catId, t), icon: true, imageId: imageIdFor(r.catId, t) }))
        : r.words.map((w) => ({ wordId: w }));
    return { categoryId: r.catId, wordsData };
  });

  const remap = (cardId: string): string => catMap.get(cardId) ?? wordMap.get(cardId) ?? cardId;
  const board = level.board.map((b) => ({ ...b, cardId: remap(b.cardId) }));
  const stock = level.stock.map(remap);

  const slots: ImageSlot[] = cats.map((c, i) => {
    const swapped = swaps.has(i);
    const r = resolved.get(i);
    const isImage = r ? r.kind === 'image' : origIsImage[i];
    const imageIds = r
      ? r.kind === 'image'
        ? r.tokens.map((t) => imageIdFor(r.catId, t))
        : []
      : origIsImage[i]
        ? origImageIds[i]
        : [];
    const tokens = r ? (r.kind === 'image' ? r.tokens : r.words) : origWords[i];
    // A non-swapped image slot is stale when its pictures aren't in the current
    // public/images set (e.g. left over from a previous art set) — re-imagize it.
    const stale =
      !swapped && origIsImage[i] && imageIds.some((id) => id !== '' && !AVAILABLE_IMAGES.has(id));
    return {
      index: i,
      letter: LETTERS[i] ?? String(i),
      originalCategoryId: c.categoryId,
      categoryId: r ? r.catId : c.categoryId,
      distinctWords: origWords[i].length,
      isImage,
      swapped,
      tokens,
      imageIds,
      stale,
      ownImageCount: ownImageTokenCount(c.categoryId),
      rollbackWords: rollbackWordCount(c.categoryId),
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
        staleCount: slots.filter((s) => s.stale).length,
        ownReadyCount: slots.filter((s) => s.distinctWords > 0 && s.ownImageCount >= s.distinctWords)
          .length,
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
        staleCount: 0,
        ownReadyCount: 0,
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
