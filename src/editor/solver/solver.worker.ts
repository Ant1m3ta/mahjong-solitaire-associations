/// <reference lib="webworker" />
import { solveSkeleton, solveGameState, type SolverResult } from './solverCore';
import type { SkeletonLevel } from '../types';
import type { GameState } from '../../types';

export type SolverRequest =
  | { requestId: number; kind: 'skeleton'; skeleton: SkeletonLevel }
  | { requestId: number; kind: 'state'; state: GameState };

export interface SolverResponse {
  requestId: number;
  result: SolverResult;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<SolverRequest>) => {
  const req = e.data;
  const result =
    req.kind === 'skeleton' ? solveSkeleton(req.skeleton) : solveGameState(req.state);
  const response: SolverResponse = { requestId: req.requestId, result };
  ctx.postMessage(response);
};
