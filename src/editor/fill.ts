import wordsCatalog from './catalog/words.json';
import { BASIC_FILL } from './basics';
import { hasImage } from './imageWords';

// The word catalog: the lookup library the editor (and batch tools) draw real
// category words from. Category/word materialization itself is now an in-place
// LevelData rewrite (see rewrite.ts / editorLevel.ts); this module is just the
// catalog plus the shared FillError the batch tools throw.

interface RawCat {
  categoryId: string;
  wordsIds: string[];
}

interface Usable {
  categoryId: string;
  wordsIds: string[];
}

export class FillError extends Error {}

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

// Merge words into the in-memory catalog (mirrors the on-disk words.json write
// the dev server does). Returns the words actually added (new, case-insensitive)
// so callers can mark them as freshly generated.
export function addCatalogWords(categoryId: string, words: string[]): string[] {
  const { all, byId } = pools();
  let entry = byId.get(categoryId);
  if (!entry) {
    entry = { categoryId, wordsIds: [] };
    all.push(entry);
    byId.set(categoryId, entry);
  }
  const seen = new Set(entry.wordsIds.map((w) => w.toLowerCase()));
  const added: string[] = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      entry.wordsIds.push(w);
      added.push(w);
    }
  }
  return added;
}
