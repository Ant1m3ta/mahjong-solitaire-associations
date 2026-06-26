import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { unfillLevel } from '../src/editor/unfill';
import { solveSkeleton } from '../src/editor/solver/solverCore';
import { solveSkeletonsParallel } from './lib/solvePool';
import type { LevelData } from '../src/types';

const dir = process.argv[2];
const opts = { maxStates: 1_000_000, maxMs: 17000 };
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const jobs = files.map((f) => ({
  key: f,
  skel: unfillLevel(JSON.parse(readFileSync(join(dir, f), 'utf-8')) as LevelData),
}));

// Serial baseline.
const s0 = performance.now();
const serial = new Map<string, string>();
for (const j of jobs) {
  const r = solveSkeleton(j.skel, opts);
  serial.set(j.key, `${r.status}:${r.movesUsed}:${r.stats.statesExplored}`);
}
const serialMs = performance.now() - s0;

// Parallel.
const cores = Number(process.argv[3]) || Math.max(1, cpus().length - 1);
const p0 = performance.now();
const par = await solveSkeletonsParallel(jobs, opts, cores);
const parMs = performance.now() - p0;

let mism = 0;
for (const j of jobs) {
  const r = par.get(j.key)!;
  const sig = `${r.status}:${r.movesUsed}:${r.stats.statesExplored}`;
  if (sig !== serial.get(j.key)) { mism++; console.log(`DIFF ${j.key}: serial=${serial.get(j.key)} par=${sig}`); }
}
console.log(`\nlevels=${jobs.length} cores=${cores} result-mismatches=${mism}`);
console.log(`serial:   ${Math.round(serialMs)}ms`);
console.log(`parallel: ${Math.round(parMs)}ms`);
console.log(`threading speedup: ${(serialMs / parMs).toFixed(2)}x`);
