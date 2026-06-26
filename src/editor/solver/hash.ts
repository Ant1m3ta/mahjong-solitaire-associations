import type { GameState } from '../../types';

// Fast 64-bit Zobrist-style state hash, returned as a short string key.
//
// Replaces the previous approach (build a ~400-char canonical string per state,
// sort it, then let the Map re-hash the whole string). That string build was
// ~80% of solver time. Here we fold the same logical features through a 32-bit
// mixer into two independent 32-bit words and emit their base36 form (~13
// chars), so callers that key a Map/Set on the result are unchanged.
//
// The feature set is identical to the old hash, so the state-equivalence
// partition is preserved (board cards and simples are interchangeable — keyed
// by category/kind/reveal/z, never uid/word):
//   - board: set of (x, y, ordered stack of (cat, isCategory, revealed, z))
//   - categorySlots: ordered (lockedCategory, cardsConsumed)
//   - hand: (cat, isCategory) or none
//   - stock: ordered (cat, isCategory)
//   - consumedSimple: per-category count (order-independent)
// movesUsed/movesLimit are intentionally excluded.

// Stable category-string -> small-int interning, shared across calls. Same
// string always maps to the same id, so hashes are comparable across states.
const catIds = new Map<string, number>();
function catId(cat: string): number {
  let id = catIds.get(cat);
  if (id === undefined) {
    id = catIds.size + 1;
    catIds.set(cat, id);
  }
  return id;
}

// Two independent 32-bit finalizers (distinct shift/multiplier constants), so
// the two accumulator words are genuinely uncorrelated → effective 64-bit hash.
// Folding both words over the *same* feature with *different* mixers is the
// standard double-hashing trick; using the same mixer with merely-scaled inputs
// leaves the words correlated (~32-bit strength) and collides at ~50k states.
function mix1(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
function mix2(x: number): number {
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39);
  return (x ^ (x >>> 16)) >>> 0;
}

// Fold an integer into each running word with its own mixer.
function fold1(h: number, v: number): number {
  return mix1((h ^ mix1(v >>> 0)) >>> 0);
}
function fold2(h: number, v: number): number {
  return mix2((h ^ mix2(v >>> 0)) >>> 0);
}

export function hashState(state: GameState): string {
  // Two independent words (different seeds) → effective 64-bit hash.
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;

  // Board: order-independent set of slots, so each slot's order-dependent
  // sub-hash is XOR-ed in. Empty slots are skipped (match old behaviour).
  for (const slot of state.boardSlots) {
    const cards = slot.cards;
    if (cards.length === 0) continue;
    let s1 = fold1(fold1(0x2545f491, slot.x), slot.y);
    let s2 = fold2(fold2(0x9e3779b1, slot.x), slot.y);
    for (let i = 0; i < cards.length; i++) {
      const e = cards[i];
      const c = catId(e.card.category);
      const flags = (e.card.isCategory ? 2 : 0) | (e.revealed ? 1 : 0);
      // index folded in so stack order matters; z and flags fully captured.
      s1 = fold1(fold1(fold1(s1, i + 0x10), c), e.z * 4 + flags);
      s2 = fold2(fold2(fold2(s2, i + 0x10), c), e.z * 4 + flags);
    }
    h1 = (h1 ^ s1) >>> 0;
    h2 = (h2 ^ s2) >>> 0;
  }

  // Category slots: positional (order matters).
  const cs = state.categorySlots;
  for (let i = 0; i < cs.length; i++) {
    const s = cs[i];
    const lc = s.lockedCategory === null ? 0 : catId(s.lockedCategory);
    h1 = fold1(fold1(fold1(h1, 0x100 + i), lc), s.cardsConsumed);
    h2 = fold2(fold2(fold2(h2, 0x100 + i), lc), s.cardsConsumed);
  }

  // Hand (single card, or an explicit "empty" marker).
  if (state.hand !== null) {
    const v = 0x300 + catId(state.hand.category) * 2 + (state.hand.isCategory ? 1 : 0);
    h1 = fold1(h1, v);
    h2 = fold2(h2, v);
  } else {
    h1 = fold1(h1, 0x3ff);
    h2 = fold2(h2, 0x3ff);
  }

  // Stock: ordered (draw order is significant).
  const stock = state.stock;
  for (let i = 0; i < stock.length; i++) {
    const c = stock[i];
    const v = catId(c.category) * 2 + (c.isCategory ? 1 : 0);
    h1 = fold1(fold1(h1, 0x400 + i), v);
    h2 = fold2(fold2(h2, 0x400 + i), v);
  }

  // Consumed simples: per-category count, order-independent → XOR.
  const counts = new Map<number, number>();
  for (const c of state.consumedSimple) {
    const id = catId(c.category);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, cnt] of counts) {
    const v = id * 1024 + cnt;
    h1 = (h1 ^ mix1(v ^ 0xf1)) >>> 0;
    h2 = (h2 ^ mix2(v ^ 0xf2)) >>> 0;
  }

  return h1.toString(36) + ',' + h2.toString(36);
}
