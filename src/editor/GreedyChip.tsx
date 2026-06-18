import type { GreedyViewState, SolverViewState } from './solver/useSolver';

export interface GreedyChipProps {
  greedy: GreedyViewState;
  solver: SolverViewState;
  onFixOrder: () => void;
  fixNote: string | null;
}

// The "straightforward player" chip: does a no-lookahead player win? When the
// optimal solver succeeds but this one softlocks, the level hides an order trap
// (category cards drawn in an order that lures the player into filling every
// slot too early). Offers a one-click stock reorder fix.
export function GreedyChip({ greedy, solver, onFixOrder, fixNote }: GreedyChipProps) {
  if (greedy.status === 'idle') {
    return <span className="difficulty-chip neutral">straightforward —</span>;
  }
  if (greedy.status === 'analyzing') {
    return <span className="difficulty-chip neutral">straightforward…</span>;
  }

  const r = greedy.result;
  if (!r || r.outcome === 'invalid' || r.outcome === 'empty') {
    return <span className="difficulty-chip neutral">straightforward —</span>;
  }

  if (r.outcome === 'won') {
    const overLimit = r.withinMoveLimit === false;
    return (
      <span
        className={`difficulty-chip severity-${overLimit ? 'yellow' : 'green'}`}
        title={
          overLimit
            ? `Straightforward play wins but uses ${r.movesUsed} moves — over the level's limit.`
            : `Straightforward play wins in ${r.movesUsed} moves. No order trap.`
        }
      >
        <span className="difficulty-headline">
          straightforward ✓ ({r.movesUsed}{overLimit ? ' — over limit' : ''})
        </span>
      </span>
    );
  }

  // softlock
  const levelBroken = solver.status === 'unsolvable';
  const title = [
    `Straightforward (no-lookahead) play softlocks after ${r.movesUsed} moves.`,
    r.deadLockedCategories.length ? `Slots dead-locked by: ${r.deadLockedCategories.join(', ')}.` : '',
    r.starvedCategories.length ? `Starved (no slot): ${r.starvedCategories.join(', ')}.` : '',
    levelBroken ? 'The level is also unsolvable optimally.' : 'Optimally solvable — this is a hidden order trap.',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span className={`difficulty-chip severity-red`} title={title}>
      <span className="difficulty-headline">
        {levelBroken ? 'softlock' : 'order trap'} @ move {r.movesUsed}
      </span>
      {!levelBroken && (
        <button
          type="button"
          className="difficulty-deep-btn"
          onClick={onFixOrder}
          title="Reorder the stock so straightforward play also wins (lossless — words/board unchanged). ⌘Z to undo."
        >
          Fix order
        </button>
      )}
      {fixNote && <span className="difficulty-fix-note">{fixNote}</span>}
    </span>
  );
}
