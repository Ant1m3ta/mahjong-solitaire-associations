// Throwaway analysis: for every level with slotsDefault===5, measure the impact
// of reducing the category-slot count to 4. Faithful Unity model = waste greedy.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeWasteGreedySkeleton } from '../src/editor/solver/wasteGreedy';
import { analyzeGreedySkeleton } from '../src/editor/solver/greedy';
import { solveSkeleton } from '../src/editor/solver/solverCore';
import { planStockReorder } from '../src/editor/reorderFix';
import type { LevelData } from '../src/types';
import type { SkeletonLevel } from '../src/editor/types';

const levelsDir = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      '/Users/caspar/Documents/Dev/StripedArts/SoliJong/unity/soli-jong/Assets/Code/Common/Feature/SoliJong/Levels',
    );

// Weighted A* (greedyWeight>1): finds *a* solution fast (proves solvability +
// approx cost) rather than proving optimal. Single-card-solvable ⟹ waste-solvable.
const A_STAR = { maxStates: 2_000_000, maxMs: 30000, greedyWeight: 3 };

function waste(skel: SkeletonLevel, slots: number) {
  return analyzeWasteGreedySkeleton({ ...skel, slotsDefault: slots });
}
function single(skel: SkeletonLevel, slots: number) {
  return analyzeGreedySkeleton({ ...skel, slotsDefault: slots });
}
function astar(skel: SkeletonLevel, slots: number) {
  return solveSkeleton({ ...skel, slotsDefault: slots }, A_STAR);
}

const files = readdirSync(levelsDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

interface Row {
  file: string;
  cats: number;
  totalSimples: number;
  movesLimit: number;
  w5: ReturnType<typeof waste>;
  w4: ReturnType<typeof waste>;
  g5: ReturnType<typeof single>;
  g4: ReturnType<typeof single>;
  a5?: ReturnType<typeof astar>;
  a4?: ReturnType<typeof astar>;
  reorderable4?: boolean;
  verdict: string;
}

const rows: Row[] = [];

for (const file of files) {
  const data = JSON.parse(readFileSync(join(levelsDir, file), 'utf-8')) as LevelData;
  if (data.slotsDefault !== 5) continue;

  let skel: SkeletonLevel;
  try {
    skel = unfillLevel(data);
  } catch (e) {
    console.log(`${file}: unfill failed — ${(e as Error).message}`);
    continue;
  }

  const cats = skel.categories.length;
  const totalSimples = skel.categories.reduce((s, c) => s + c.simpleCards, 0);
  const w5 = waste(skel, 5);
  const w4 = waste(skel, 4);
  const g5 = single(skel, 5);
  const g4 = single(skel, 4);

  // A* (solvability witness) only where a greedy heuristic softlocks at that slot count.
  const a5 = w5.outcome !== 'won' && g5.outcome !== 'won' ? astar(skel, 5) : undefined;
  const a4 = w4.outcome !== 'won' && g4.outcome !== 'won' ? astar(skel, 4) : undefined;

  // Does straightforward (no-lookahead) play still win at 4 slots?
  const straightWins4 = w4.outcome === 'won' || g4.outcome === 'won';
  const straightWins5 = w5.outcome === 'won' || g5.outcome === 'won';
  const cost4 = w4.outcome === 'won' ? w4.movesUsed : g4.outcome === 'won' ? g4.movesUsed : null;
  const cost5 = w5.outcome === 'won' ? w5.movesUsed : g5.outcome === 'won' ? g5.movesUsed : null;

  let reorderable4: boolean | undefined;
  let verdict: string;

  if (straightWins4) {
    const overLimit = data.movesLimit >= 0 && cost4! > data.movesLimit;
    const delta = cost5 != null ? cost4! - cost5 : null;
    if (!straightWins5) {
      verdict = `IMPROVES? (4-slot straightforward wins in ${cost4}, but 5-slot greedy softlocked — heuristic noise)`;
    } else if (overLimit) {
      verdict = `MOVE-LIMIT (straightforward win ${cost4} > limit ${data.movesLimit}; would pop)`;
    } else if (delta != null && delta > 0) {
      verdict = `MINOR (still wins; +${delta} moves → ${cost4}, within limit ${data.movesLimit})`;
    } else {
      verdict = `NO IMPACT (straightforward still wins in ${cost4}, no extra cost)`;
    }
  } else {
    // Straightforward play softlocks at 4 slots. Was it fine at 5?
    if (a4 && a4.status === 'solved') {
      const plan = planStockReorder({ ...skel, slotsDefault: 4 });
      reorderable4 = plan.status === 'fixed';
      if (straightWins5) {
        verdict = `ORDER TRAP (regression: 5-slot straightforward won in ${cost5}; 4-slot softlocks but A* solvable in ${a4.movesUsed}; reorder ${reorderable4 ? 'FIXES' : 'cannot fix'})`;
      } else {
        verdict = `ALREADY HARD @5 too (softlocks at both; A*@4 solvable in ${a4.movesUsed}; reorder ${reorderable4 ? 'FIXES' : 'cannot fix'})`;
      }
    } else if (a4 && a4.status === 'unsolvable') {
      verdict = straightWins5
        ? `BREAKS (5-slot won in ${cost5}; 4-slot has NO single-card solution)`
        : `HARD/UNSOLVABLE @5 & @4 (no single-card solution at 4)`;
    } else {
      const a5note = a5 ? ` [A*@5 ${a5.status}]` : '';
      verdict = straightWins5
        ? `LIKELY TRAP (5-slot won in ${cost5}; 4-slot softlocks, A*@4 ${a4?.status})`
        : `ALREADY SOFTLOCKS @5 (greedy fails both; A*@4 ${a4?.status}${a5note})`;
    }
  }

  rows.push({ file, cats, totalSimples, movesLimit: data.movesLimit, w5, w4, g5, g4, a5, a4, reorderable4, verdict });
}

// Sort by level number for readable output.
rows.sort((a, b) => {
  const n = (s: string) => parseInt(s.replace(/\D/g, ''), 10) || 0;
  return n(a.file) - n(b.file);
});

const og = (o: string, m: number) => (o === 'won' ? `win@${m}` : `${o}@${m}`);

console.log(`\n=== ${rows.length} levels with 5 category slots ===\n`);
for (const r of rows) {
  console.log(
    `${r.file.replace('.json', '').padEnd(6)} cats=${String(r.cats).padStart(2)} simples=${String(r.totalSimples).padStart(2)} limit=${String(r.movesLimit).padStart(3)}  ` +
      `waste[5:${og(r.w5.outcome, r.w5.movesUsed)} 4:${og(r.w4.outcome, r.w4.movesUsed)}]  ` +
      `single[5:${og(r.g5.outcome, r.g5.movesUsed)} 4:${og(r.g4.outcome, r.g4.movesUsed)}]`,
  );
  console.log(`   → ${r.verdict}`);
}

const ids = (rs: Row[]) => rs.map((r) => r.file.replace('.json', '')).join(', ');
const noImpact = rows.filter((r) => r.verdict.startsWith('NO IMPACT'));
const minor = rows.filter((r) => r.verdict.startsWith('MINOR'));
const moveLimit = rows.filter((r) => r.verdict.startsWith('MOVE-LIMIT'));
const trap = rows.filter((r) => r.verdict.startsWith('ORDER TRAP'));
const breaks = rows.filter((r) => r.verdict.startsWith('BREAKS'));
const alreadyHard = rows.filter((r) => r.verdict.includes('ALREADY') || r.verdict.startsWith('HARD') || r.verdict.startsWith('LIKELY'));
const other = rows.filter(
  (r) => !noImpact.includes(r) && !minor.includes(r) && !moveLimit.includes(r) && !trap.includes(r) && !breaks.includes(r) && !alreadyHard.includes(r),
);

console.log(`\n=== SUMMARY (reducing 5 → 4 category slots) ===`);
console.log(`Total 5-slot levels:               ${rows.length}`);
console.log(`NO IMPACT (plays the same):        ${noImpact.length}  [${ids(noImpact)}]`);
console.log(`MINOR (extra moves, within limit): ${minor.length}  [${ids(minor)}]`);
console.log(`MOVE-LIMIT (exceeds limit, pops):  ${moveLimit.length}  [${ids(moveLimit)}]`);
console.log(`ORDER TRAP (regression):           ${trap.length}  [${ids(trap)}]`);
console.log(`BREAKS (unsolvable at 4):          ${breaks.length}  [${ids(breaks)}]`);
console.log(`ALREADY HARD at 5 too:             ${alreadyHard.length}  [${ids(alreadyHard)}]`);
if (other.length) console.log(`OTHER:                             ${other.length}  [${ids(other)}]`);
