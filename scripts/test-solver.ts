import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unfillLevel } from '../src/editor/unfill';
import { solveSkeleton } from '../src/editor/solver/solverCore';
import type { LevelData } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const levelsDir = resolve(__dirname, '..', 'src', 'levels');

const requested = process.argv.slice(2);
const files =
  requested.length > 0
    ? requested.map((n) => (n.endsWith('.json') ? n : `${n}.json`))
    : readdirSync(levelsDir).filter((f) => f.endsWith('.json'));

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
  const t0 = performance.now();
  const result = solveSkeleton(skel, { maxStates: 200000, maxMs: 6000 });
  const elapsed = performance.now() - t0;
  const totals =
    `board=${skel.board.length} stock=${skel.stock.length} cats=${skel.categories.length} ` +
    `simples=${skel.categories.reduce((s, c) => s + c.simpleCards, 0)} ` +
    `movesLimit=${skel.movesLimit}`;
  if (result.status === 'solved') {
    console.log(
      `${file}: solved in ${result.movesUsed} moves · ${result.stats.statesExplored} states · ${Math.round(elapsed)}ms · ${totals}`,
    );
  } else if (result.status === 'unsolvable') {
    console.log(`${file}: unsolvable · ${result.stats.statesExplored} states · ${Math.round(elapsed)}ms · ${totals}`);
  } else if (result.status === 'timeout') {
    console.log(
      `${file}: timeout (${result.message}) · ${result.stats.statesExplored} states · ${Math.round(elapsed)}ms · ${totals}`,
    );
  } else {
    console.log(`${file}: ${result.status} (${result.message ?? ''}) · ${totals}`);
  }
}
