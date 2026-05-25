import type { GameState } from '../../types';

export function hashState(state: GameState): string {
  const slotStrings: string[] = [];
  for (const slot of state.boardSlots) {
    if (slot.cards.length === 0) continue;
    const stack = slot.cards
      .map((e) => `${e.card.category}${e.card.isCategory ? 'C' : 's'}${e.revealed ? '+' : '-'}${e.z}`)
      .join(',');
    slotStrings.push(`${slot.x},${slot.y}|${stack}`);
  }
  slotStrings.sort();

  const catSlots = state.categorySlots
    .map((s) => `${s.lockedCategory ?? '-'}:${s.cardsConsumed}`)
    .join(',');
  const hand = state.hand
    ? `${state.hand.category}${state.hand.isCategory ? 'C' : 's'}`
    : '-';
  const stock = state.stock
    .map((c) => `${c.category}${c.isCategory ? 'C' : 's'}`)
    .join(',');
  const consumedByCat = new Map<string, number>();
  for (const c of state.consumedSimple) {
    consumedByCat.set(c.category, (consumedByCat.get(c.category) ?? 0) + 1);
  }
  const consumed = Array.from(consumedByCat.entries())
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
  return `${slotStrings.join('#')}|${catSlots}|${hand}|${stock}|${consumed}`;
}
