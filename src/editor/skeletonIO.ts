import type { CardKind, SkeletonBoardCard, SkeletonCategory, SkeletonLevel, SkeletonStockEntry } from './types';

export const SKELETON_SCHEMA = 'skeleton-v1';

export class SkeletonParseError extends Error {}

export function serializeSkeleton(level: SkeletonLevel): string {
  const out = { $schema: SKELETON_SCHEMA, ...level };
  return JSON.stringify(out, null, 2);
}

export function downloadSkeleton(level: SkeletonLevel) {
  const json = serializeSkeleton(level);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${level.levelId || 'skeleton'}.skel.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ensureString(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new SkeletonParseError(`${path}: expected string`);
  return v;
}

function ensureInt(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new SkeletonParseError(`${path}: expected integer`);
  }
  return v;
}

function ensureCardKind(v: unknown, path: string): CardKind {
  if (v !== 'category' && v !== 'simple') {
    throw new SkeletonParseError(`${path}: expected 'category' or 'simple', got ${JSON.stringify(v)}`);
  }
  return v;
}

export function parseSkeleton(text: string): SkeletonLevel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SkeletonParseError(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object') throw new SkeletonParseError('Root is not an object.');
  const obj = raw as Record<string, unknown>;

  if (obj.$schema !== SKELETON_SCHEMA) {
    throw new SkeletonParseError(`Unsupported schema: ${JSON.stringify(obj.$schema)}. Expected "${SKELETON_SCHEMA}".`);
  }

  const levelId = ensureString(obj.levelId, 'levelId');
  const slotsDefault = ensureInt(obj.slotsDefault, 'slotsDefault');
  const movesLimit = ensureInt(obj.movesLimit, 'movesLimit');

  if (!Array.isArray(obj.categories)) throw new SkeletonParseError('categories: expected array');
  const categories: SkeletonCategory[] = obj.categories.map((c, i) => {
    if (!c || typeof c !== 'object') throw new SkeletonParseError(`categories[${i}]: not an object`);
    const cc = c as Record<string, unknown>;
    const letter = ensureString(cc.letter, `categories[${i}].letter`);
    const simpleCards = ensureInt(cc.simpleCards, `categories[${i}].simpleCards`);
    const pinnedCategoryId = cc.pinnedCategoryId === undefined ? undefined : ensureString(cc.pinnedCategoryId, `categories[${i}].pinnedCategoryId`);
    return { letter, simpleCards, pinnedCategoryId };
  });

  if (!Array.isArray(obj.board)) throw new SkeletonParseError('board: expected array');
  const board: SkeletonBoardCard[] = obj.board.map((b, i) => {
    if (!b || typeof b !== 'object') throw new SkeletonParseError(`board[${i}]: not an object`);
    const bb = b as Record<string, unknown>;
    return {
      x: ensureInt(bb.x, `board[${i}].x`),
      y: ensureInt(bb.y, `board[${i}].y`),
      z: ensureInt(bb.z, `board[${i}].z`),
      letter: ensureString(bb.letter, `board[${i}].letter`),
      kind: ensureCardKind(bb.kind, `board[${i}].kind`),
    };
  });

  if (!Array.isArray(obj.stock)) throw new SkeletonParseError('stock: expected array');
  const stock: SkeletonStockEntry[] = obj.stock.map((s, i) => {
    if (!s || typeof s !== 'object') throw new SkeletonParseError(`stock[${i}]: not an object`);
    const ss = s as Record<string, unknown>;
    return {
      letter: ensureString(ss.letter, `stock[${i}].letter`),
      kind: ensureCardKind(ss.kind, `stock[${i}].kind`),
    };
  });

  const level: SkeletonLevel = { levelId, slotsDefault, movesLimit, categories, board, stock };

  validateInvariant(level);
  return level;
}

function validateInvariant(level: SkeletonLevel) {
  const letterSet = new Set(level.categories.map((c) => c.letter));
  for (const cat of level.categories) {
    if (cat.simpleCards < 0) throw new SkeletonParseError(`category ${cat.letter}: simpleCards < 0`);
  }
  const counts = new Map<string, { category: number; simple: number }>();
  function bump(letter: string, kind: CardKind) {
    if (!letterSet.has(letter)) {
      throw new SkeletonParseError(`Card references unknown category "${letter}".`);
    }
    let c = counts.get(letter);
    if (!c) {
      c = { category: 0, simple: 0 };
      counts.set(letter, c);
    }
    c[kind]++;
  }
  for (const b of level.board) bump(b.letter, b.kind);
  for (const s of level.stock) bump(s.letter, s.kind);

  for (const cat of level.categories) {
    const c = counts.get(cat.letter) ?? { category: 0, simple: 0 };
    if (c.category !== 1) {
      throw new SkeletonParseError(
        `Category ${cat.letter}: expected exactly 1 category card across board+stock, found ${c.category}.`,
      );
    }
    if (c.simple !== cat.simpleCards) {
      throw new SkeletonParseError(
        `Category ${cat.letter}: simpleCards=${cat.simpleCards} but board+stock has ${c.simple}.`,
      );
    }
  }
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
