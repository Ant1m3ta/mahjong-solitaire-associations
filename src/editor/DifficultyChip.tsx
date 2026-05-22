import { useState } from 'react';
import type { DifficultyViewState } from './solver/useSolver';

export interface DifficultyChipProps {
  difficulty: DifficultyViewState;
  runDeepAnalysis: () => void;
}

export function DifficultyChip({ difficulty, runDeepAnalysis }: DifficultyChipProps) {
  const [showTraps, setShowTraps] = useState(false);

  if (difficulty.status === 'idle') {
    return <span className="difficulty-chip neutral">difficulty —</span>;
  }
  if (difficulty.status === 'analyzing') {
    const label = difficulty.mode === 'deep' ? 'deep analyzing…' : 'analyzing…';
    return <span className="difficulty-chip neutral">{label}</span>;
  }
  const r = difficulty.result;
  if (!r || difficulty.status !== 'ok') {
    return (
      <span className="difficulty-chip invalid" title={r?.message}>
        difficulty: {r?.status ?? 'n/a'}
      </span>
    );
  }

  const fh = r.failureHorizon;
  const headline =
    fh === 0
      ? 'broken (0)'
      : fh !== null
        ? `failure: ${fh}`
        : r.truncated
          ? `≥ ${r.searchedDepth + 1} (partial)`
          : `≥ ${r.searchedDepth + 1}`;

  const severity =
    fh === null
      ? 'green'
      : fh <= 1
        ? 'red'
        : fh === 2
          ? 'orange'
          : fh <= 4
            ? 'yellow'
            : 'green';

  const trapsCount = r.worstFirstMoves.length;
  const depthOne = r.trapsByDepth.find((d) => d.depth === 1);
  const totalFirstActions = depthOne?.totalActions ?? 0;

  const statsLine = `${r.stats.statesClassified.toLocaleString()} states classified · ${r.stats.cacheHits.toLocaleString()} cache hits · ${Math.round(r.stats.elapsedMs)}ms`;
  const title = [
    fh === 0
      ? 'Initial state has no winning continuation.'
      : fh === null
        ? r.truncated
          ? `No fatal action in the first ${r.searchedDepth} decision${r.searchedDepth === 1 ? '' : 's'} — budget hit before deeper layers finished.`
          : `No fatal action in the first ${r.searchedDepth} decision${r.searchedDepth === 1 ? '' : 's'}.`
        : `A wrong choice at decision ${fh} can kill the level.`,
    statsLine,
  ].join('\n');

  return (
    <span className={`difficulty-chip severity-${severity}`} title={title}>
      <span className="difficulty-headline">{headline}</span>
      {trapsCount > 0 && totalFirstActions > 0 && fh === 1 && (
        <>
          <span className="difficulty-sep">·</span>
          <button
            type="button"
            className="difficulty-trap-toggle"
            onClick={() => setShowTraps((s) => !s)}
            title="Show the fatal first moves"
          >
            {trapsCount}/{totalFirstActions} fatal {showTraps ? '▴' : '▾'}
          </button>
        </>
      )}
      <button
        type="button"
        className="difficulty-deep-btn"
        onClick={runDeepAnalysis}
        title="Re-run with depth 50 / 60s budget."
      >
        Analyze deeper
      </button>
      {showTraps && r.worstFirstMoves.length > 0 && (
        <ul className="difficulty-trap-list">
          {r.worstFirstMoves.map((m, i) => (
            <li key={i}>{m.reason}</li>
          ))}
        </ul>
      )}
    </span>
  );
}
