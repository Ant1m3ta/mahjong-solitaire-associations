import type { BoardCardEntry, BoardSlot } from '../types';

// A "chain" is the contiguous top suffix of a slot's stack whose entries are
// all revealed and share the same `category`. Chains form via gameplay only —
// pre-stacked cards from level data start unrevealed, so a multi-card stack at
// load is not a chain until its lower cards get surfaced. Chains move and
// consume as a unit; a chain of 1 is just a regular single card.
export function getChainEntries(slot: BoardSlot): BoardCardEntry[] {
  if (slot.cards.length === 0) return [];
  const top = slot.cards[slot.cards.length - 1];
  if (!top.revealed) return [top];
  const topCat = top.card.category;
  let start = slot.cards.length - 1;
  while (start > 0) {
    const prev = slot.cards[start - 1];
    if (!prev.revealed) break;
    if (prev.card.category !== topCat) break;
    start--;
  }
  return slot.cards.slice(start);
}

export function footprintsOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  if (a.x === b.x && a.y === b.y) return false;
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

function effectiveLayer(slot: BoardSlot): number {
  // Effective render layer = base z * 100 + stack-position-within-slot.
  // Lets a card stacked on top of another count as visually higher than a
  // same-z half-offset card next to it, matching the rendering z-index.
  const top = slot.cards[slot.cards.length - 1];
  return top.z * 100 + (slot.cards.length - 1);
}

export function isSlotRevealed(slot: BoardSlot, allSlots: BoardSlot[]): boolean {
  if (slot.cards.length === 0) return false;
  const myLayer = effectiveLayer(slot);
  for (const other of allSlots) {
    if (other === slot) continue;
    if (other.cards.length === 0) continue;
    if (!footprintsOverlap(slot, other)) continue;
    if (effectiveLayer(other) > myLayer) return false;
  }
  return true;
}

export function findSlot(slots: BoardSlot[], x: number, y: number): BoardSlot | null {
  return slots.find((s) => s.x === x && s.y === y) ?? null;
}
