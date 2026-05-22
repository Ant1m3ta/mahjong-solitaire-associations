/// <reference lib="webworker" />
import { solveSkeleton, solveGameState, type SolverResult } from './solverCore';
import {
  analyzeDifficulty,
  AUTO_DIFFICULTY_OPTIONS,
  DEEP_DIFFICULTY_OPTIONS,
  type DifficultyOptions,
  type DifficultyResult,
} from './difficulty';
import type { SkeletonLevel } from '../types';
import type { GameState } from '../../types';

export type SolverRequest =
  | { requestId: number; kind: 'skeleton'; skeleton: SkeletonLevel }
  | { requestId: number; kind: 'state'; state: GameState }
  | {
      requestId: number;
      kind: 'difficulty';
      skeleton: SkeletonLevel;
      mode: 'auto' | 'deep';
      opts?: DifficultyOptions;
    };

export type SolverResponse =
  | { requestId: number; kind: 'solver'; result: SolverResult }
  | { requestId: number; kind: 'difficulty'; result: DifficultyResult };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<SolverRequest>) => {
  const req = e.data;
  if (req.kind === 'difficulty') {
    const base = req.mode === 'deep' ? DEEP_DIFFICULTY_OPTIONS : AUTO_DIFFICULTY_OPTIONS;
    const result = analyzeDifficulty(req.skeleton, { ...base, ...(req.opts ?? {}) });
    const response: SolverResponse = { requestId: req.requestId, kind: 'difficulty', result };
    ctx.postMessage(response);
    return;
  }
  const result =
    req.kind === 'skeleton' ? solveSkeleton(req.skeleton) : solveGameState(req.state);
  const response: SolverResponse = { requestId: req.requestId, kind: 'solver', result };
  ctx.postMessage(response);
};
