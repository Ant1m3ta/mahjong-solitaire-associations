// Reduce every 5-category-slot level to 4 slots, fixing what the faithful
// waste-pile model says is fixable:
//   * winnable as-is at 4 slots                  → just set slotsDefault:4
//   * winnable but over the (tight) move limit   → raise movesLimit to new cost
//   * softlocks at 4 slots                       → waste-verified stock reorder
//   * reorder can't rescue it                    → LEFT UNCHANGED (deferred)
// Lossless: only slotsDefault, movesLimit, and stock ORDER change. Dry-run by
// default; --write applies in place (2-space JSON + trailing newline).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeWasteGreedySkeleton } from '../src/editor/solver/wasteGreedy';
import { planStockReorder, applyOrderToSkeleton, applyOrderToLevel } from '../src/editor/reorderFix';
import type { LevelData } from '../src/types';
import type { SkeletonLevel } from '../src/editor/types';

const WRITE = process.argv.includes('--write');
const dirArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const levelsDir = dirArg
  ? resolve(dirArg)
  : resolve(
      '/Users/caspar/Documents/Dev/StripedArts/SoliJong/unity/soli-jong/Assets/Code/Common/Feature/SoliJong/Levels',
    );

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleWith(arr: number[], rng: () => number): number[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const wasteWins = (skel: SkeletonLevel) => {
  const r = analyzeWasteGreedySkeleton(skel);
  return r.outcome === 'won' ? r.movesUsed : null;
};

// Search for a stock order that makes the WASTE greedy (faithful Unity model)
// win, picking the lowest competent cost found. Seeds with the single-card
// planner's order (cheap, minimal-diff) before falling back to seeded shuffles.
function findWasteWinningOrder(
  skel: SkeletonLevel,
  budget = 8000,
  maxWins = 250,
): { order: number[]; cost: number } | null {
  const wins: { order: number[]; cost: number }[] = [];
  const tryOrder = (order: number[]) => {
    const cost = wasteWins(applyOrderToSkeleton(skel, order));
    if (cost != null) wins.push({ order, cost });
  };

  const plan = planStockReorder(skel);
  if (plan.status === 'fixed' && plan.order) tryOrder(plan.order);

  const n = skel.stock.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const rng = mulberry32((0x9e3779b9 ^ Math.imul(n, 2654435761)) >>> 0);
  for (let t = 0; t < budget && wins.length < maxWins; t++) {
    tryOrder(shuffleWith(idx.slice(), rng));
  }
  if (wins.length === 0) return null;
  wins.sort((a, b) => a.cost - b.cost);
  return wins[0];
}

interface Plan {
  file: string;
  status: 'as-is' | 'limit-bump' | 'reorder' | 'reorder+limit' | 'unfixable';
  cats: number;
  origLimit: number;
  newLimit: number;
  cost4: number | null;
  order?: number[];
  diffStock?: number; // how many stock positions changed
  note: string;
}

const files = readdirSync(levelsDir).filter((f) => f.endsWith('.json'));
const plans: Plan[] = [];

for (const file of files) {
  const raw = readFileSync(join(levelsDir, file), 'utf-8');
  const data = JSON.parse(raw) as LevelData;
  if (data.slotsDefault !== 5) continue;

  const skel4: SkeletonLevel = { ...unfillLevel(data), slotsDefault: 4 };
  const cats = skel4.categories.length;
  const origLimit = data.movesLimit;

  const direct = wasteWins(skel4);
  let plan: Plan;

  if (direct != null) {
    const newLimit = origLimit >= 0 && direct > origLimit ? direct : origLimit;
    plan = {
      file,
      status: newLimit !== origLimit ? 'limit-bump' : 'as-is',
      cats,
      origLimit,
      newLimit,
      cost4: direct,
      note:
        newLimit !== origLimit
          ? `wins in ${direct}; raise limit ${origLimit}→${newLimit}`
          : `wins in ${direct}, within limit ${origLimit}`,
    };
  } else {
    const fix = findWasteWinningOrder(skel4);
    if (fix) {
      const diffStock = fix.order.reduce((n, srcIdx, pos) => n + (srcIdx !== pos ? 1 : 0), 0);
      const newLimit = origLimit >= 0 && fix.cost > origLimit ? fix.cost : origLimit;
      plan = {
        file,
        status: newLimit !== origLimit ? 'reorder+limit' : 'reorder',
        cats,
        origLimit,
        newLimit,
        cost4: fix.cost,
        order: fix.order,
        diffStock,
        note:
          `reorder stock (${diffStock}/${fix.order.length} moved) → wins in ${fix.cost}` +
          (newLimit !== origLimit ? `; raise limit ${origLimit}→${newLimit}` : `, within limit ${origLimit}`),
      };
    } else {
      const r = analyzeWasteGreedySkeleton(skel4);
      const why = [
        r.deadLockedCategories.length ? `dead-locked: ${r.deadLockedCategories.join(',')}` : '',
        r.starvedCategories.length ? `starved: ${r.starvedCategories.join(',')}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      plan = {
        file,
        status: 'unfixable',
        cats,
        origLimit,
        newLimit: origLimit,
        cost4: null,
        note: `no stock order wins at 4 slots — board-driven (${why || 'softlock'}). LEFT AT 5 SLOTS.`,
      };
    }
  }
  plans.push(plan);
}

plans.sort((a, b) => (parseInt(a.file.replace(/\D/g, '')) || 0) - (parseInt(b.file.replace(/\D/g, '')) || 0));

console.log(`\n=== Reduce 5→4 slots: plan for ${plans.length} levels (${WRITE ? 'WRITING' : 'dry-run'}) ===\n`);
for (const p of plans) {
  const tag = p.status.toUpperCase().padEnd(13);
  console.log(`${tag} ${p.file.replace('.json', '').padEnd(6)} cats=${p.cats}  ${p.note}`);
}

// Apply.
let written = 0;
for (const p of plans) {
  if (p.status === 'unfixable') continue;
  const path = join(levelsDir, p.file);
  const raw = readFileSync(path, 'utf-8');
  const trailing = raw.endsWith('\n') ? '\n' : '';
  const data = JSON.parse(raw) as LevelData;

  data.slotsDefault = 4;
  if (p.newLimit !== p.origLimit) data.movesLimit = p.newLimit;
  const out = p.order ? applyOrderToLevel(data, p.order) : data;
  // keep key order: applyOrderToLevel spreads data, so slotsDefault/movesLimit/etc stay first.
  const serialized = JSON.stringify(out, null, 2) + trailing;

  if (WRITE) {
    writeFileSync(path, serialized);
    written++;
  }
}

const by = (s: Plan['status']) => plans.filter((p) => p.status === s).map((p) => p.file.replace('.json', ''));
console.log(`\n=== SUMMARY ===`);
console.log(`as-is (slots only):     ${by('as-is').length}  [${by('as-is').join(', ')}]`);
console.log(`limit-bump:             ${by('limit-bump').length}  [${by('limit-bump').join(', ')}]`);
console.log(`reorder:                ${by('reorder').length}  [${by('reorder').join(', ')}]`);
console.log(`reorder+limit:          ${by('reorder+limit').length}  [${by('reorder+limit').join(', ')}]`);
console.log(`unfixable (left at 5):  ${by('unfixable').length}  [${by('unfixable').join(', ')}]`);
const fixable = plans.filter((p) => p.status !== 'unfixable').length;
console.log(`\nFixable to 4 slots: ${fixable}/${plans.length}.  ${WRITE ? `Wrote ${written} files.` : 'Re-run with --write to apply.'}`);
