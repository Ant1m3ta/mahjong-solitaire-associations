import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { buildSolverInput } from '../src/editor/solver/buildState';
import { enumerateMoves } from '../src/editor/solver/enumerate';
import { hashState } from '../src/editor/solver/hash';
import { applyAction, isWon } from '../src/game/moves';
import { searchHeuristic } from '../src/editor/solver/heuristic';
import { MinHeap } from '../src/editor/solver/heap';
import type { Action, GameState } from '../src/types';

// Faithful replica of solverCore.runSearch with fine-grained timers covering
// the WHOLE inner loop (heap + visited included), to attribute real wall-clock.
const dir = process.argv[2];
const data = JSON.parse(readFileSync(join(dir, (process.argv[3] ?? 'QA_10') + '.json'), 'utf-8'));
const { initialState } = buildSolverInput(unfillLevel(data));
const CAP = Number(process.argv[4] ?? 250000);

let tHash = 0, tApply = 0, tEnum = 0, tHeur = 0, tHeapPush = 0, tHeapPop = 0, tVis = 0, tWon = 0;
const now = () => performance.now();

interface VE { parent: string | null; action: Action | null; g: number; }
const visited = new Map<string, VE>();
const heap = new MinHeap<{ hash: string; state: GameState; g: number }>();
let t = now(); const ih = hashState(initialState); tHash += now() - t;
visited.set(ih, { parent: null, action: null, g: 0 });
heap.push(searchHeuristic(initialState), { hash: ih, state: initialState, g: 0 });
let pops = 0;
const t0 = now();
while (heap.size() > 0) {
  if (visited.size >= CAP) break;
  t = now(); const popped = heap.pop()!; tHeapPop += now() - t;
  pops++;
  const { hash, state, g } = popped.value;
  const v = visited.get(hash);
  if (!v || v.g < g) continue;
  t = now(); const won = isWon(state); tWon += now() - t;
  if (won) break;
  t = now(); const actions = enumerateMoves(state, { drawOnlyWhenHandEmpty: false }); tEnum += now() - t;
  for (const action of actions) {
    let next: GameState;
    t = now();
    try { next = applyAction(state, action); } catch { tApply += now() - t; continue; }
    tApply += now() - t;
    t = now(); const nh = hashState(next); tHash += now() - t;
    const ng = g + 1;
    t = now(); const ex = visited.get(nh); tVis += now() - t;
    if (ex && ex.g <= ng) continue;
    t = now(); visited.set(nh, { parent: hash, action, g: ng }); tVis += now() - t;
    t = now(); const h = searchHeuristic(next); tHeur += now() - t;
    t = now(); heap.push(ng + h, { hash: nh, state: next, g: ng }); tHeapPush += now() - t;
  }
}
const wall = now() - t0;
const parts: [string, number][] = [
  ['hashState', tHash], ['applyAction(clone)', tApply], ['enumerateMoves', tEnum],
  ['heap.push', tHeapPush], ['heap.pop', tHeapPop], ['visited get/set', tVis],
  ['searchHeuristic', tHeur], ['isWon', tWon],
];
const acc = parts.reduce((s, [, x]) => s + x, 0);
console.log(`states=${visited.size} pops=${pops} wall=${Math.round(wall)}ms  (unattributed/GC ~${Math.round(wall - acc)}ms)`);
for (const [k, x] of parts.sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(20)} ${(100 * x / wall).toFixed(1).padStart(5)}%  ${x.toFixed(0).padStart(6)}ms`);
