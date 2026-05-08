import type { AppAction, AppState, GameState, LevelData } from '../types';
import { buildInitialState } from './init';
import { applyAction, isLost, isWon } from './moves';

export function makeInitialAppState(level: LevelData): AppState {
  return {
    state: buildInitialState(level),
    history: [],
    outcome: 'playing',
    lastError: null,
  };
}

export function reduce(app: AppState, action: AppAction): AppState {
  if (action.type === 'RESET') {
    return makeInitialAppState(action.level);
  }
  if (action.type === 'ROLLBACK') {
    if (app.history.length === 0) return app;
    const prev = app.history[app.history.length - 1];
    return {
      state: prev,
      history: app.history.slice(0, -1),
      outcome: 'playing',
      lastError: null,
    };
  }
  if (action.type === 'ADD_BONUS_SLOT') {
    if (app.state.bonusSlotUsed) return app;
    if (app.outcome !== 'playing') return app;
    const newState: GameState = {
      ...app.state,
      categorySlots: [
        ...app.state.categorySlots,
        { lockedCategory: null, displayedCard: null, cardsConsumed: 0 },
      ],
      bonusSlotUsed: true,
    };
    return {
      state: newState,
      history: [...app.history, app.state],
      outcome: 'playing',
      lastError: null,
    };
  }
  if (app.outcome !== 'playing') return app;
  let newState: GameState;
  try {
    newState = applyAction(app.state, action);
  } catch (e) {
    return { ...app, lastError: (e as Error).message };
  }
  let outcome: AppState['outcome'] = 'playing';
  if (isWon(newState)) outcome = 'won';
  else if (isLost(newState)) outcome = 'lost';
  return {
    state: newState,
    history: [...app.history, app.state],
    outcome,
    lastError: null,
  };
}
