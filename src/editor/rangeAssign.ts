import categoryList from './catalog/category_list.json';
import { pools } from './fill';
import { isGenerated, type GenRequest } from './wordGen';
import type { SkeletonCategory } from './types';

export const CATEGORY_LIST = categoryList as string[];

export interface SlotPreview {
  letter: string;
  simpleCards: number;
  listIndex: number;
  inRange: boolean;
  categoryId: string;
  chosen: string[];
  generated: boolean[]; // parallel to chosen — true if the word came from AI, not the catalog
  shortfall: number;
  duplicate: boolean;
  overridden: boolean; // category was manually replaced, not taken from the list at listIndex
}

// All catalog words for a name. The pool is mutated in place when words are
// generated (see fill.addCatalogWords), so this includes session-generated
// words too.
export function wordsForName(name: string): string[] {
  return (pools().byId.get(name)?.wordsIds ?? []).slice();
}

// Assign the next `categories.length` list entries (from startIndex) to the
// given slots, choosing each slot's words deterministically and keeping every
// word unique across the whole window (the game resolver needs that).
// `overrides` (by letter) replaces a slot's sequential category with an
// explicit one — used when the listed category can't supply enough words.
export function computeAssignments(
  categories: SkeletonCategory[],
  startIndex: number,
  overrides?: Record<string, string>,
): SlotPreview[] {
  const nameFor = (cat: SkeletonCategory, i: number): string | undefined =>
    overrides?.[cat.letter] ?? CATEGORY_LIST[startIndex + i];

  const reserved = new Set<string>(); // every window category name — words may not equal one
  categories.forEach((cat, i) => {
    const name = nameFor(cat, i);
    if (name !== undefined) reserved.add(name.toLowerCase());
  });

  const usedWords = new Set<string>();
  const seenNames = new Set<string>();
  const out: SlotPreview[] = [];

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const idx = startIndex + i;
    const overridden = overrides?.[cat.letter] !== undefined;
    const name = nameFor(cat, i);
    if (name === undefined) {
      out.push({
        letter: cat.letter,
        simpleCards: cat.simpleCards,
        listIndex: idx,
        inRange: false,
        categoryId: '',
        chosen: [],
        generated: [],
        shortfall: cat.simpleCards,
        duplicate: false,
        overridden,
      });
      continue;
    }
    const duplicate = seenNames.has(name.toLowerCase());
    seenNames.add(name.toLowerCase());

    const chosen: string[] = [];
    const generated: boolean[] = [];
    for (const w of wordsForName(name)) {
      if (chosen.length >= cat.simpleCards) break;
      const k = w.toLowerCase();
      if (usedWords.has(k) || reserved.has(k)) continue;
      chosen.push(w);
      generated.push(isGenerated(name, w));
      usedWords.add(k);
    }
    out.push({
      letter: cat.letter,
      simpleCards: cat.simpleCards,
      listIndex: idx,
      inRange: true,
      categoryId: name,
      chosen,
      generated,
      shortfall: cat.simpleCards - chosen.length,
      duplicate,
      overridden,
    });
  }
  return out;
}

// Build dedup'd generation requests for every short slot in a window, telling
// the model which words to avoid (existing catalog/cache words for that name,
// every word already chosen in the window, and every window category name).
export function buildGenRequests(previews: SlotPreview[], buffer = 0): GenRequest[] {
  const short = previews.filter((p) => p.inRange && p.shortfall > 0);
  if (short.length === 0) return [];
  const windowNames = previews.filter((p) => p.inRange).map((p) => p.categoryId);
  const allChosen = previews.flatMap((p) => p.chosen);
  const byName = new Map<string, GenRequest>();
  for (const p of short) {
    const prev = byName.get(p.categoryId);
    const count = p.shortfall + buffer;
    if (prev) {
      prev.count = Math.max(prev.count, count);
      continue;
    }
    const avoid = Array.from(
      new Set([...wordsForName(p.categoryId), ...allChosen, ...windowNames]),
    );
    byName.set(p.categoryId, { categoryId: p.categoryId, count, avoid });
  }
  return Array.from(byName.values());
}
