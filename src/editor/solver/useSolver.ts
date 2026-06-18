import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkeletonLevel } from '../types';
import type { SolverResponse } from './solver.worker';
import type { SolverResult } from './solverCore';
import type { DifficultyResult } from './difficulty';
import type { GreedyResult } from './greedy';

export interface SolverViewState {
  status: 'idle' | 'solving' | SolverResult['status'];
  message?: string;
  movesUsed?: number;
  moveIndexByCellKey: Map<string, number>;
  statesExplored?: number;
  elapsedMs?: number;
}

export type DifficultyViewStatus = 'idle' | 'analyzing' | 'ok' | 'invalid' | 'empty';

export interface DifficultyViewState {
  status: DifficultyViewStatus;
  mode: 'auto' | 'deep' | null;
  result: DifficultyResult | null;
}

export interface GreedyViewState {
  status: 'idle' | 'analyzing' | 'done';
  result: GreedyResult | null;
}

const IDLE: SolverViewState = {
  status: 'idle',
  moveIndexByCellKey: new Map(),
};

const IDLE_DIFFICULTY: DifficultyViewState = {
  status: 'idle',
  mode: null,
  result: null,
};

const IDLE_GREEDY: GreedyViewState = {
  status: 'idle',
  result: null,
};

const SOLVER_DEBOUNCE_MS = 300;
const DIFFICULTY_AUTO_DEBOUNCE_MS = 1000;

export interface SolverBundle {
  solver: SolverViewState;
  difficulty: DifficultyViewState;
  greedy: GreedyViewState;
  runDeepAnalysis: () => void;
}

export function useSolver(skeleton: SkeletonLevel, enabled: boolean): SolverBundle {
  const [solverView, setSolverView] = useState<SolverViewState>(IDLE);
  const [difficultyView, setDifficultyView] = useState<DifficultyViewState>(IDLE_DIFFICULTY);
  const [greedyView, setGreedyView] = useState<GreedyViewState>(IDLE_GREEDY);
  const workerRef = useRef<Worker | null>(null);
  const solverRequestId = useRef(0);
  const difficultyRequestId = useRef(0);
  const greedyRequestId = useRef(0);
  const lastSkeletonRef = useRef<SkeletonLevel | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSolverView(IDLE);
      setDifficultyView(IDLE_DIFFICULTY);
      setGreedyView(IDLE_GREEDY);
      return;
    }
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<SolverResponse>) => {
      if (e.data.kind === 'solver') {
        if (e.data.requestId !== solverRequestId.current) return;
        const r = e.data.result;
        setSolverView({
          status: r.status,
          message: r.message,
          movesUsed: r.movesUsed,
          moveIndexByCellKey: new Map(r.moveIndexByCellKey),
          statesExplored: r.stats.statesExplored,
          elapsedMs: r.stats.elapsedMs,
        });
      } else if (e.data.kind === 'greedy') {
        if (e.data.requestId !== greedyRequestId.current) return;
        setGreedyView({ status: 'done', result: e.data.result });
      } else {
        if (e.data.requestId !== difficultyRequestId.current) return;
        const r = e.data.result;
        setDifficultyView((v) => ({
          status: r.status === 'ok' ? 'ok' : r.status,
          mode: v.mode,
          result: r,
        }));
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    lastSkeletonRef.current = skeleton;
    if (!enabled) return;
    const w = workerRef.current;
    if (!w) return;
    setSolverView((v) => ({ ...v, status: 'solving' }));
    setDifficultyView({ status: 'analyzing', mode: 'auto', result: null });
    setGreedyView({ status: 'analyzing', result: null });
    const solverId = ++solverRequestId.current;
    const difficultyId = ++difficultyRequestId.current;
    const greedyId = ++greedyRequestId.current;
    const solverTimer = window.setTimeout(() => {
      // Greedy first: it is sub-ms, and the worker runs messages serially — the
      // A* skeleton solve can take seconds, so queue greedy ahead of it.
      w.postMessage({ requestId: greedyId, kind: 'greedy', skeleton });
      w.postMessage({ requestId: solverId, kind: 'skeleton', skeleton });
    }, SOLVER_DEBOUNCE_MS);
    const difficultyTimer = window.setTimeout(() => {
      w.postMessage({
        requestId: difficultyId,
        kind: 'difficulty',
        skeleton,
        mode: 'auto',
      });
    }, DIFFICULTY_AUTO_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(solverTimer);
      window.clearTimeout(difficultyTimer);
    };
  }, [skeleton, enabled]);

  const runDeepAnalysis = useCallback(() => {
    if (!enabled) return;
    const w = workerRef.current;
    if (!w) return;
    const skel = lastSkeletonRef.current;
    if (!skel) return;
    const id = ++difficultyRequestId.current;
    setDifficultyView({ status: 'analyzing', mode: 'deep', result: null });
    w.postMessage({ requestId: id, kind: 'difficulty', skeleton: skel, mode: 'deep' });
  }, [enabled]);

  return { solver: solverView, difficulty: difficultyView, greedy: greedyView, runDeepAnalysis };
}
