// Batch-fix "order traps": for every level the straightforward player softlocks
// on, reorder its stock (lossless — permutes existing cardIds, nothing else
// changes) so it no longer does. Dry-run by default; pass --write to apply.
// Levels whose trap is board-driven are reported, never touched.
//
//   npx tsx scripts/fix-order.ts [dir] [--write]
//
// `dir` defaults to src/levels. Only existing *.json files are rewritten (Unity
// *.json.meta files are ignored), and each file keeps its trailing-newline style.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeGreedySkeleton } from '../src/editor/solver/greedy';
import { planStockReorder, applyOrderToLevel } from '../src/editor/reorderFix';
import type { LevelData } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes('--write');
const dirArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const levelsDir = dirArg ? resolve(dirArg) : resolve(__dirname, '..', 'src', 'levels');

const files = readdirSync(levelsDir).filter((f) => f.endsWith('.json'));
let fixed = 0;
let fair = 0;
let errors = 0;
const unfixable: string[] = [];

for (const file of files) {
  const path = join(levelsDir, file);
  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw) as LevelData;

  let skel;
  try {
    skel = unfillLevel(data);
  } catch (e) {
    errors++;
    console.log(`${file}: unfill error — ${(e as Error).message}`);
    continue;
  }

  const plan = planStockReorder(skel);
  if (plan.status === 'already-fair') {
    fair++;
    continue;
  }
  if (plan.status === 'unfixable' || !plan.order) {
    unfixable.push(file);
    continue;
  }

  const out = applyOrderToLevel(data, plan.order);
  // Safety gate before touching disk: must be a pure permutation and verified
  // to make the straightforward player win.
  const lossless = [...data.stock].sort().join('|') === [...out.stock].sort().join('|');
  const greedy = analyzeGreedySkeleton(unfillLevel(out)).outcome;
  if (!lossless || greedy !== 'won') {
    errors++;
    console.log(`${file}: VERIFY FAILED (lossless=${lossless} greedy=${greedy}) — skipped`);
    continue;
  }

  const moved = data.stock.filter((c, i) => c !== out.stock[i]).length;
  fixed++;
  console.log(
    `${file}: order trap → reordered ${moved}/${data.stock.length} positions${WRITE ? ' [written]' : ' [dry-run]'}`,
  );
  if (WRITE) writeFileSync(path, JSON.stringify(out, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
}

console.log(
  `\n${fixed} reordered · ${fair} already fair · ${unfixable.length} unfixable by reorder · ${errors} errors · ${files.length} files`,
);
if (unfixable.length) {
  console.log(`\nunfixable by stock reorder (board-driven — need a board / slot-count change):\n  ${unfixable.join(', ')}`);
}
if (!WRITE && fixed > 0) console.log('\nRe-run with --write to apply.');
