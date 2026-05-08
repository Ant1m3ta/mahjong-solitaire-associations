import type { BoardSlot } from '../types';

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
  if (slot.dead || slot.cards.length === 0) return false;
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

// Mahjong-style edge rule: slot's top is "free" if at least one of its 4
// cardinal neighbours (left, right, above, below) at the same z-layer is open.
// Locked only when fully surrounded on all 4 sides at the same z.
export function isSlotSideBlocked(slot: BoardSlot, allSlots: BoardSlot[]): boolean {
  if (slot.cards.length === 0) return false;
  const topZ = slot.cards[slot.cards.length - 1].z;
  const blocks = (s: BoardSlot | null): boolean =>
    !!s && !s.dead && s.cards.some((c) => c.z === topZ);
  const left = findSlot(allSlots, slot.x - 2, slot.y);
  const right = findSlot(allSlots, slot.x + 2, slot.y);
  const above = findSlot(allSlots, slot.x, slot.y - 2);
  const below = findSlot(allSlots, slot.x, slot.y + 2);
  return blocks(left) && blocks(right) && blocks(above) && blocks(below);
}

export function isSlotInteractive(slot: BoardSlot, allSlots: BoardSlot[]): boolean {
  return isSlotRevealed(slot, allSlots) && !isSlotSideBlocked(slot, allSlots);
}
