/// <reference lib="webworker" />
import { solveSkeleton, type SolverResult } from './solverCore';
import type { SkeletonLevel } from '../types';

export interface SolverRequest {
  requestId: number;
  skeleton: SkeletonLevel;
}

export interface SolverResponse {
  requestId: number;
  result: SolverResult;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<SolverRequest>) => {
  const { requestId, skeleton } = e.data;
  const result = solveSkeleton(skeleton);
  const response: SolverResponse = { requestId, result };
  ctx.postMessage(response);
};
