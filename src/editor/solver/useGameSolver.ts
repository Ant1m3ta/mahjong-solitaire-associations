import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../../types';
import type { SolverResponse } from './solver.worker';
import type { SolverViewState } from './useSolver';

const IDLE: SolverViewState = {
  status: 'idle',
  moveIndexByCellKey: new Map(),
};

// Like useSolver but takes a live GameState. Re-solves on every state change
// so play mode can echo the editor's move-index badges and status chip.
//
// Re-creates the worker on each request: the previous solve might still be
// running and would otherwise block the new one (a Web Worker processes
// messages serially and the solver's loop is synchronous).
export function useGameSolver(state: GameState, enabled: boolean): SolverViewState {
  const [view, setView] = useState<SolverViewState>(IDLE);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      setView(IDLE);
      return;
    }

    if (workerRef.current) {
      workerRef.current.terminate();
    }
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    const id = ++requestIdRef.current;
    worker.onmessage = (e: MessageEvent<SolverResponse>) => {
      if (e.data.requestId !== id) return;
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
    setView((v) => ({ ...v, status: 'solving' }));
    worker.postMessage({ requestId: id, kind: 'state', state });

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [state, enabled]);

  return view;
}
