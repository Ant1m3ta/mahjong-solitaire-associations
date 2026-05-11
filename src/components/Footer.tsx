import type { Dispatch } from 'react';
import type { AppAction, LevelData } from '../types';

interface Props {
  dispatch: Dispatch<AppAction>;
  canRollback: boolean;
  levels: LevelData[];
  currentLevelIdx: number;
  onLevelChange: (idx: number) => void;
  highlightUnplayable: boolean;
  onToggleHighlight: () => void;
}

export function Footer({
  dispatch,
  canRollback,
  levels,
  currentLevelIdx,
  onLevelChange,
  highlightUnplayable,
  onToggleHighlight,
}: Props) {
  return (
    <div className="container footer">
      <div className="level-picker">
        {levels.map((lvl, i) => (
          <button
            key={lvl.levelId}
            className={i === currentLevelIdx ? 'active' : ''}
            onClick={() => onLevelChange(i)}
          >
            Level {lvl.levelId}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`toggle-btn ${highlightUnplayable ? 'active' : ''}`}
        onClick={onToggleHighlight}
        title="Toggle dimming for cards that have nowhere to go"
      >
        {highlightUnplayable ? '☑' : '☐'} Highlight no-match
      </button>
      <button
        className="rollback-btn"
        disabled={!canRollback}
        onClick={() => dispatch({ type: 'ROLLBACK' })}
      >
        ← Rollback
      </button>
    </div>
  );
}
