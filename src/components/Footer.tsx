import type { Dispatch } from 'react';
import type { AppAction } from '../types';

interface Props {
  dispatch: Dispatch<AppAction>;
  canRollback: boolean;
  highlightUnplayable: boolean;
  onToggleHighlight: () => void;
}

export function Footer({
  dispatch,
  canRollback,
  highlightUnplayable,
  onToggleHighlight,
}: Props) {
  return (
    <div className="container footer">
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
