import { solveSkeleton, type SolverOptions } from '../../src/editor/solver/solverCore';
import type { SkeletonLevel } from '../../src/editor/types';

// Child-process side of the batch solve pool (scripts/lib/solvePool.ts). Each
// level is an independent A* search; we solve whatever skeleton arrives over IPC
// and send the result back. Forked (not worker_threads) so the child inherits
// the parent's execArgv — i.e. the tsx loader — and can import the TS solver.
interface Job { id: number; skel: SkeletonLevel; opts: Partial<SolverOptions>; }

process.on('message', (job: Job) => {
  try {
    const result = solveSkeleton(job.skel, job.opts);
    process.send!({ id: job.id, result });
  } catch (e) {
    process.send!({ id: job.id, error: String((e as Error)?.message ?? e) });
  }
});
