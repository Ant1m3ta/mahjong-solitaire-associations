import { fork, execSync, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { SolverOptions, SolverResult } from '../../src/editor/solver/solverCore';
import type { SkeletonLevel } from '../../src/editor/types';

// Best concurrency = number of *performance* cores. On Apple Silicon `cpus()`
// counts E-cores too, but a heavy A* on an E-core barely helps and oversubscribing
// past the P-cores drops total throughput. Use the P-core count where we can
// detect it (darwin), else fall back to logical-1.
export function defaultConcurrency(): number {
  try {
    if (process.platform === 'darwin') {
      const p = Number(execSync('sysctl -n hw.perflevel0.physicalcpu').toString().trim());
      if (p > 0) return p;
    }
  } catch { /* fall through */ }
  return Math.max(1, cpus().length - 1);
}

// Run many independent level solves across a pool of forked processes. Each
// level's A* is independent, so this is near-linear in core count — the cheapest
// big speedup for the batch CLIs (order-by-difficulty, benchmarks, etc.).
//
// Node-only (lives under scripts/, never imported by the browser editor/game).
// Forked children inherit the parent's execArgv (the tsx loader), so the .ts
// worker entry and the TS solver import resolve without extra setup.

export interface SolveJob<K> {
  key: K;
  skel: SkeletonLevel;
}

export async function solveSkeletonsParallel<K>(
  jobs: SolveJob<K>[],
  opts: Partial<SolverOptions> = {},
  concurrency: number = defaultConcurrency(),
): Promise<Map<K, SolverResult>> {
  const results = new Map<K, SolverResult>();
  if (jobs.length === 0) return results;

  const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'solve.worker.ts');
  const poolSize = Math.min(concurrency, jobs.length);

  let nextJob = 0;
  let done = 0;

  return new Promise<Map<K, SolverResult>>((resolvePromise, reject) => {
    const children: ChildProcess[] = [];

    const dispatch = (child: ChildProcess) => {
      if (nextJob >= jobs.length) {
        child.disconnect();
        return;
      }
      const idx = nextJob++;
      child.send({ id: idx, skel: jobs[idx].skel, opts });
    };

    const finishMaybe = () => {
      if (done === jobs.length) {
        for (const c of children) if (c.connected) c.disconnect();
        resolvePromise(results);
      }
    };

    for (let i = 0; i < poolSize; i++) {
      const child = fork(workerPath, [], { execArgv: process.execArgv });
      children.push(child);
      child.on('message', (msg: { id: number; result?: SolverResult; error?: string }) => {
        if (msg.result) results.set(jobs[msg.id].key, msg.result);
        else { reject(new Error(`solve worker failed on ${String(jobs[msg.id].key)}: ${msg.error}`)); return; }
        done++;
        finishMaybe();
        dispatch(child);
      });
      child.on('error', reject);
      dispatch(child);
    }
  });
}
