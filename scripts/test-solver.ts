import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveLevel } from '../src/editor/solver/solverCore';
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
  const t0 = performance.now();
  const result = solveLevel(data, { maxStates: 200000, maxMs: 6000 });
  const elapsed = performance.now() - t0;
  const totals =
    `board=${data.board.length} stock=${data.stock.length} cats=${data.categories.length} ` +
    `simples=${data.categories.reduce((s, c) => s + c.wordsData.length, 0)} ` +
    `movesLimit=${data.movesLimit}`;
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
