import type { SkeletonBoardCard, SkeletonLevel } from './types';

export interface Warning {
  severity: 'error' | 'warn' | 'info';
  text: string;
}

interface SlotView {
  x: number;
  y: number;
  cards: SkeletonBoardCard[];
}

function footprintsOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  if (a.x === b.x && a.y === b.y) return false;
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

function buildSlots(skel: SkeletonLevel): SlotView[] {
  const map = new Map<string, SlotView>();
  for (const c of skel.board) {
    const key = `${c.x},${c.y}`;
    let s = map.get(key);
    if (!s) {
      s = { x: c.x, y: c.y, cards: [] };
      map.set(key, s);
    }
    s.cards.push(c);
  }
  for (const s of map.values()) s.cards.sort((a, b) => a.z - b.z);
  return Array.from(map.values());
}

function effectiveLayer(slot: SlotView): number {
  const top = slot.cards[slot.cards.length - 1];
  return top.z * 100 + (slot.cards.length - 1);
}

export interface ValidationResult {
  warnings: Warning[];
  sideBlockedCount: number;
  coveredCount: number;
  totalBoard: number;
  totalStock: number;
}

export function validate(skel: SkeletonLevel): ValidationResult {
  const warnings: Warning[] = [];

  if (skel.board.length > 0) {
    let lo = skel.board[0].z;
    for (const c of skel.board) if (c.z < lo) lo = c.z;
    if (lo !== 0) {
      warnings.push({
        severity: 'info',
        text: `Lowest z is ${lo}. Save & Play normalize automatically; click Normalize to do it now.`,
      });
    }
  }

  const slots = buildSlots(skel);
  let coveredCount = 0;
  for (const slot of slots) {
    if (slot.cards.length === 0) continue;
    const myLayer = effectiveLayer(slot);
    let blocker: SlotView | null = null;
    for (const other of slots) {
      if (other === slot) continue;
      if (other.cards.length === 0) continue;
      if (!footprintsOverlap(slot, other)) continue;
      if (effectiveLayer(other) > myLayer) {
        blocker = other;
        break;
      }
    }
    if (blocker) {
      coveredCount++;
      const topZ = slot.cards[slot.cards.length - 1].z;
      const otherTopZ = blocker.cards[blocker.cards.length - 1].z;
      warnings.push({
        severity: 'warn',
        text: `(${slot.x},${slot.y},z=${topZ}) hidden at start under (${blocker.x},${blocker.y},z=${otherTopZ}).`,
      });
    }
  }

  let sideBlockedCount = 0;
  for (const slot of slots) {
    if (slot.cards.length === 0) continue;
    const topZ = slot.cards[slot.cards.length - 1].z;
    const blocks = (sx: number, sy: number): boolean => {
      const s = slots.find((s2) => s2.x === sx && s2.y === sy);
      return !!s && s.cards.some((c) => c.z === topZ);
    };
    if (
      blocks(slot.x - 2, slot.y) &&
      blocks(slot.x + 2, slot.y) &&
      blocks(slot.x, slot.y - 2) &&
      blocks(slot.x, slot.y + 2)
    ) {
      sideBlockedCount++;
    }
  }

  for (const cat of skel.categories) {
    if (cat.kind === 'icon') {
      const needed = cat.simpleCards;
      if (needed > 32) {
        warnings.push({
          severity: 'warn',
          text: `Category ${cat.letter} (icon): ${needed} simples is more than any single available image category has.`,
        });
      }
    }
  }

  if (skel.categories.length === 0 && skel.board.length === 0 && skel.stock.length === 0) {
    warnings.push({ severity: 'info', text: 'Empty level. Add a category to begin.' });
  }

  return {
    warnings,
    sideBlockedCount,
    coveredCount,
    totalBoard: skel.board.length,
    totalStock: skel.stock.length,
  };
}
