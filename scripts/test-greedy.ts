import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeGreedySkeleton } from '../src/editor/solver/greedy';
import { planStockReorder } from '../src/editor/reorderFix';
import type { LevelData } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const levelsDir = resolve(__dirname, '..', 'src', 'levels');

const requested = process.argv.slice(2);
const files =
  requested.length > 0
    ? requested.map((n) => (n.endsWith('.json') ? n : `${n}.json`))
    : readdirSync(levelsDir).filter((f) => f.endsWith('.json'));

let fair = 0;
let traps = 0;
let fixable = 0;
let unfixable = 0;

for (const file of files) {
  const path = join(levelsDir, file);
  const data = JSON.parse(readFileSync(path, 'utf-8')) as LevelData;
  let skel;
  try {
    skel = unfillLevel(data);
  } catch (e) {
    console.log(`${file}: unfill failed — ${(e as Error).message}`);
    continue;
  }

  const g = analyzeGreedySkeleton(skel);
  if (g.outcome === 'won') {
    fair++;
    const over = g.withinMoveLimit === false ? ' (OVER move limit)' : '';
    console.log(`${file}: fair · straightforward wins in ${g.movesUsed}${over}`);
  } else if (g.outcome === 'softlock') {
    traps++;
    const diag = `dead-locked: [${g.deadLockedCategories.join(', ')}] starved: [${g.starvedCategories.join(', ')}]`;
    const plan = planStockReorder(skel);
    if (plan.status === 'fixed') {
      fixable++;
      console.log(`${file}: ORDER TRAP softlock@${g.movesUsed} · reorder FIXES · ${diag}`);
    } else {
      unfixable++;
      console.log(`${file}: ORDER TRAP softlock@${g.movesUsed} · reorder CANNOT fix — ${plan.reason}`);
    }
  } else {
    console.log(`${file}: ${g.outcome}${g.message ? ` — ${g.message}` : ''}`);
  }
}

console.log(
  `\n${fair} fair · ${traps} trap${traps === 1 ? '' : 's'} (${fixable} reorder-fixable, ${unfixable} not) · ${files.length} files`,
);
