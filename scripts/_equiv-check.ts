// Throwaway: assert the LevelData-native solver path matches the skeleton path
// for every level in a dir (greedy, waste, and a budgeted A*). Detects any
// divergence from the re-point — notably word-reuse-across-tiles levels where
// buildInitialState (wordsData length) and buildSolverInput (one word per tile)
// disagree. Usage: npx tsx scripts/_equiv-check.ts <dir>
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeGreedySkeleton, analyzeGreedyLevel } from '../src/editor/solver/greedy';
import { analyzeWasteGreedySkeleton, analyzeWasteGreedyLevel } from '../src/editor/solver/wasteGreedy';
import { solveSkeleton, solveLevel } from '../src/editor/solver/solverCore';
import type { LevelData } from '../src/types';

const dir = resolve(process.argv[2] ?? 'src/levels');
const A_STAR = { maxStates: 300_000, maxMs: 5000 };
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'order.json').sort();

let ok = 0;
const mism: string[] = [];

for (const file of files) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as LevelData;
  let skel;
  try { skel = unfillLevel(data); } catch (e) { console.log(`${file}: SKEL unfill error — ${(e as Error).message}`); continue; }

  const gS = analyzeGreedySkeleton(skel);
  const gL = analyzeGreedyLevel(data);
  const wS = analyzeWasteGreedySkeleton(skel);
  const wL = analyzeWasteGreedyLevel(data);
  const aS = solveSkeleton(skel, A_STAR);
  const aL = solveLevel(data, A_STAR);

  const probs: string[] = [];
  if (gS.outcome !== gL.outcome || gS.movesUsed !== gL.movesUsed)
    probs.push(`greedy ${gS.outcome}@${gS.movesUsed} vs ${gL.outcome}@${gL.movesUsed}`);
  if (wS.outcome !== wL.outcome || wS.movesUsed !== wL.movesUsed)
    probs.push(`waste ${wS.outcome}@${wS.movesUsed} vs ${wL.outcome}@${wL.movesUsed}`);
  // A*: compare status, and movesUsed when both solved. Ignore when either timed out.
  if (aS.status !== 'timeout' && aL.status !== 'timeout') {
    if (aS.status !== aL.status) probs.push(`astar status ${aS.status} vs ${aL.status}`);
    else if (aS.status === 'solved' && aS.movesUsed !== aL.movesUsed)
      probs.push(`astar moves ${aS.movesUsed} vs ${aL.movesUsed}`);
  }

  if (probs.length) mism.push(`${file}: ${probs.join(' · ')}`);
  else ok++;
}

console.log(`\n${ok}/${files.length} match.`);
if (mism.length) {
  console.log(`\n${mism.length} MISMATCH:`);
  for (const m of mism) console.log(`  ${m}`);
} else {
  console.log('All levels: skeleton path ≡ LevelData path. Re-point is behaviour-preserving.');
}
