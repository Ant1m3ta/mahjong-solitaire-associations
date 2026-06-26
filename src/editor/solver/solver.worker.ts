/// <reference lib="webworker" />
import { solveLevel, solveGameState, type SolverResult } from './solverCore';
import {
  analyzeDifficultyLevel,
  AUTO_DIFFICULTY_OPTIONS,
  DEEP_DIFFICULTY_OPTIONS,
  type DifficultyOptions,
  type DifficultyResult,
} from './difficulty';
import { analyzeGreedyLevel, type GreedyResult } from './greedy';
import type { GameState, LevelData } from '../../types';

export type SolverRequest =
  | { requestId: number; kind: 'solve'; level: LevelData }
  | { requestId: number; kind: 'state'; state: GameState }
  | { requestId: number; kind: 'greedy'; level: LevelData }
  | {
      requestId: number;
      kind: 'difficulty';
      level: LevelData;
      mode: 'auto' | 'deep';
      opts?: DifficultyOptions;
    };

export type SolverResponse =
  | { requestId: number; kind: 'solver'; result: SolverResult }
  | { requestId: number; kind: 'greedy'; result: GreedyResult }
  | { requestId: number; kind: 'difficulty'; result: DifficultyResult };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<SolverRequest>) => {
  const req = e.data;
  if (req.kind === 'difficulty') {
    const base = req.mode === 'deep' ? DEEP_DIFFICULTY_OPTIONS : AUTO_DIFFICULTY_OPTIONS;
    const result = analyzeDifficultyLevel(req.level, { ...base, ...(req.opts ?? {}) });
    const response: SolverResponse = { requestId: req.requestId, kind: 'difficulty', result };
    ctx.postMessage(response);
    return;
  }
  if (req.kind === 'greedy') {
    const result = analyzeGreedyLevel(req.level);
    const response: SolverResponse = { requestId: req.requestId, kind: 'greedy', result };
    ctx.postMessage(response);
    return;
  }
  const result = req.kind === 'solve' ? solveLevel(req.level) : solveGameState(req.state);
  const response: SolverResponse = { requestId: req.requestId, kind: 'solver', result };
  ctx.postMessage(response);
};
