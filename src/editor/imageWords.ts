import type { WordData } from '../types';
import { AVAILABLE_IMAGES } from './catalog/images';

// Shared word/image helpers — the single source of truth for how a category's
// word becomes a WordData (and the matching board/stock cardId, which is always
// the resulting wordId). Used by fill.ts (skeleton fill) and rewrite.ts (in-place
// category rewrite) so the two can't drift on icon/imageId/placeholder emission.

export function toSnake(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function imageBasename(categoryId: string, wordId: string): string {
  return `${toSnake(categoryId)}__${toSnake(wordId)}`;
}

export function hasImage(categoryId: string, wordId: string): boolean {
  return AVAILABLE_IMAGES.has(imageBasename(categoryId, wordId));
}

// Build a WordData for a word in a category. A placeholder gap is flagged
// `missing`; otherwise a word with a matching PNG (and not forced text-only)
// becomes an icon word. The returned `wordId` is also the cardId any board/stock
// tile referencing this word must use.
export function makeWordData(
  categoryId: string,
  word: string,
  missing: boolean,
  textOnly: boolean,
): WordData {
  if (missing) return { wordId: word, missing: true };
  if (textOnly) return { wordId: word };
  return hasImage(categoryId, word)
    ? { wordId: toSnake(word), icon: true, imageId: imageBasename(categoryId, word) }
    : { wordId: word };
}

// Padding word for a short category, flagged so the fix tool can find it. Unique
// level-wide (caller supplies a monotonic n) so board/stock cardIds stay
// unambiguous.
export function placeholderWord(n: number): string {
  return `(needs word ${n})`;
}

// The highest N used by an existing "(needs word N)" placeholder in the level,
// so freshly padded gaps can continue past it without colliding.
export function maxPlaceholderN(wordIds: Iterable<string>): number {
  let max = 0;
  for (const id of wordIds) {
    const m = /^\(needs word (\d+)\)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}
