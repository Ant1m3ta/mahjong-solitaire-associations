import { useEffect, useRef, useState } from 'react';
import type { SkeletonLevel } from '../types';
import type { SolverResponse } from './solver.worker';
import type { SolverResult } from './solverCore';

export interface SolverViewState {
  status: 'idle' | 'solving' | SolverResult['status'];
  message?: string;
  movesUsed?: number;
  moveIndexByCellKey: Map<string, number>;
  statesExplored?: number;
  elapsedMs?: number;
}

const IDLE: SolverViewState = {
  status: 'idle',
  moveIndexByCellKey: new Map(),
};

export function useSolver(
  skeleton: SkeletonLevel,
  enabled: boolean,
  debounceMs = 300,
): SolverViewState {
  const [view, setView] = useState<SolverViewState>(IDLE);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setView(IDLE);
      return;
    }
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<SolverResponse>) => {
      if (e.data.requestId !== requestIdRef.current) return;
      const r = e.data.result;
      setView({
        status: r.status,
        message: r.message,
        movesUsed: r.movesUsed,
        moveIndexByCellKey: new Map(r.moveIndexByCellKey),
        statesExplored: r.stats.statesExplored,
        elapsedMs: r.stats.elapsedMs,
      });
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const w = workerRef.current;
    if (!w) return;
    setView((v) => ({ ...v, status: 'solving' }));
    const id = ++requestIdRef.current;
    const t = window.setTimeout(() => {
      w.postMessage({ requestId: id, skeleton });
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [skeleton, enabled, debounceMs]);

  return view;
}
