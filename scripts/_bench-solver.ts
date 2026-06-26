import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { solveSkeleton } from '../src/editor/solver/solverCore';
import type { LevelData } from '../src/types';

const levelsDir = process.argv[2];
const files = readdirSync(levelsDir).filter((f) => f.endsWith('.json'));

let totalMs = 0, totalStates = 0, timeouts = 0;
const rows: {file:string; status:string; moves?:number; states:number; ms:number}[] = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(join(levelsDir, file), 'utf-8')) as LevelData;
  let skel; try { skel = unfillLevel(data); } catch { continue; }
  const t0 = performance.now();
  const r = solveSkeleton(skel, { maxStates: 1_000_000, maxMs: 17000 });
  const ms = performance.now() - t0;
  totalMs += ms; totalStates += r.stats.statesExplored;
  if (r.status === 'timeout') timeouts++;
  rows.push({ file, status: r.status, moves: r.movesUsed, states: r.stats.statesExplored, ms });
}
rows.sort((a,b)=>b.ms-a.ms);
for (const r of rows.slice(0, 15)) {
  console.log(`${r.file.padEnd(12)} ${r.status.padEnd(10)} moves=${String(r.moves ?? '-').padStart(3)} states=${String(r.states).padStart(8)} ${Math.round(r.ms).toString().padStart(7)}ms  (${Math.round(r.states/(r.ms||1))} st/ms)`);
}
console.log(`\nTOTAL: ${Math.round(totalMs)}ms  ${totalStates} states  timeouts=${timeouts}  avg ${Math.round(totalStates/(totalMs||1))} states/ms`);
