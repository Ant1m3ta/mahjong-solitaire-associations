import { useReducer, useState, useEffect, useMemo } from 'react';
import { LEVELS } from './levels';
import { makeInitialAppState, reduce } from './game/reducer';
import { isDeadlocked } from './game/shuffle';
import { Header } from './components/Header';
import { CategorySlotsRow } from './components/CategorySlotsRow';
import { Board } from './components/Board';
import { Overlay } from './components/Overlay';

export function App() {
  const [levelIdx, setLevelIdx] = useState(0);
  const [appState, dispatch] = useReducer(reduce, LEVELS[0], makeInitialAppState);
  const [highlightUnplayable, setHighlightUnplayable] = useState(false);

  useEffect(() => {
    if (appState.lastError) {
      console.warn('Move rejected:', appState.lastError);
    }
  }, [appState.lastError]);

  function handleLevelChange(idx: number) {
    setLevelIdx(idx);
    dispatch({ type: 'RESET', level: LEVELS[idx] });
  }

  function handleRestart() {
    dispatch({ type: 'RESET', level: LEVELS[levelIdx] });
  }

  function handleNextLevel() {
    const next = (levelIdx + 1) % LEVELS.length;
    handleLevelChange(next);
  }

  const overlayDisabled = appState.outcome !== 'playing';

  const deadlocked = useMemo(
    () => appState.outcome === 'playing' && isDeadlocked(appState.state),
    [appState.outcome, appState.state],
  );

  return (
    <div className="app">
      <Header
        state={appState.state}
        dispatch={dispatch}
        disabled={overlayDisabled}
        highlightUnplayable={highlightUnplayable}
        onToggleHighlight={() => setHighlightUnplayable((v) => !v)}
        levels={LEVELS}
        currentLevelIdx={levelIdx}
        onLevelChange={handleLevelChange}
        canRollback={appState.history.length > 0}
      />
      <CategorySlotsRow state={appState.state} dispatch={dispatch} disabled={overlayDisabled} />
      <Board
        state={appState.state}
        dispatch={dispatch}
        disabled={overlayDisabled}
        highlightUnplayable={highlightUnplayable}
      />

      {deadlocked && (
        <div className="stuck-banner" role="alert">
          <span className="stuck-banner-text">No moves available</span>
          <button
            type="button"
            className="stuck-banner-btn"
            onClick={() => dispatch({ type: 'SHUFFLE' })}
          >
            Shuffle
          </button>
        </div>
      )}

      {appState.outcome === 'won' && (
        <Overlay
          title="You won!"
          subtitle={`Cleared in ${appState.state.movesUsed} moves`}
          primaryLabel="Next level"
          onPrimary={handleNextLevel}
          secondaryLabel="Play again"
          onSecondary={handleRestart}
        />
      )}
      {appState.outcome === 'lost' && (
        <Overlay
          title="Out of moves"
          subtitle="Try again — rollback all the way is free."
          primaryLabel="Restart"
          onPrimary={handleRestart}
        />
      )}
    </div>
  );
}
