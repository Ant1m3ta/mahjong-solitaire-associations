// Order levels into a difficulty curve and (optionally) rewrite the Unity
// level-order file. Difficulty is computed from the existing analyzers:
//   * foresight wall  — straightforward (greedy) player softlocks  -> hardest band
//   * execution tight — A* optimal moves / authored move limit
//   * cognitive load  — categories minus parallel slots
//   D = 0.5*tight + 0.3*load + 0.2*length  (softlocks forced to the top band)
//
// The metric yields a difficulty RANKING; the curve is a lossless permutation
// of that ranking onto positions. Curve "A" (sawtooth/flat): each 5-level cycle
// ramps easy->hard then resets to the same band (no macro progression).
//
//   npx tsx scripts/order-by-difficulty.ts <levelsDir> [orderFile] [--write]
//
// Without --write it prints the order (dry run). With --write it rewrites
// orderFile (a JSON array of levelIds), preserving its one-id-per-line style,
// after verifying the new order is a pure permutation of the existing ids.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeGreedySkeleton } from '../src/editor/solver/greedy';
import { solveSkeleton } from '../src/editor/solver/solverCore';
import type { LevelData } from '../src/types';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const positional = argv.filter((a) => !a.startsWith('--'));
const levelsDir = positional[0];
const orderFile = positional[1];
if (!levelsDir) {
  console.error('usage: order-by-difficulty.ts <levelsDir> [orderFile] [--write]');
  process.exit(1);
}

const CYCLE = 5;

const numKey = (f: string) => Number(f.replace(/\D/g, '')) || 0;
const files = readdirSync(resolve(levelsDir))
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => numKey(a) - numKey(b));

interface Lvl {
  levelId: string;
  trap: boolean;
  util: number; // optMoves / movesLimit (execution tightness)
  press: number; // categories - slots (cognitive load)
  length: number; // optimal move count
  D: number;
}

const lvls: Lvl[] = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(resolve(levelsDir, file), 'utf-8')) as LevelData;
  const skel = unfillLevel(data);
  const greedy = analyzeGreedySkeleton(skel);
  const opt = solveSkeleton(skel, { maxStates: 300_000, maxMs: 8000 });
  // A* optimal when it solves; otherwise fall back to the straightforward line.
  let optMoves = greedy.movesUsed;
  if (opt.status === 'solved' && opt.movesUsed !== undefined) optMoves = opt.movesUsed;
  lvls.push({
    levelId: data.levelId,
    trap: greedy.outcome === 'softlock',
    util: data.movesLimit > 0 ? optMoves / data.movesLimit : 0,
    press: data.categories.length - data.slotsDefault,
    length: optMoves,
    D: 0,
  });
}

const norm = (vals: number[]) => {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);
};
const nU = norm(lvls.map((l) => l.util));
const nP = norm(lvls.map((l) => l.press));
const nL = norm(lvls.map((l) => l.length));
for (const l of lvls) {
  const fair = 0.5 * nU(l.util) + 0.3 * nP(l.press) + 0.2 * nL(l.length);
  l.D = l.trap ? 0.9 + 0.1 * fair : 0.85 * fair;
}

// Stable sort easy -> hard (ties keep numeric file order for reproducibility).
const ranked = lvls.map((l, i) => ({ l, i })).sort((a, b) => a.l.D - b.l.D || a.i - b.i).map((x) => x.l);
const N = ranked.length;

if (process.env.DEBUG_RANK) {
  console.error('rank\tlevel\tD\ttrap\tutil\tpress\tlen');
  ranked.forEach((l, i) =>
    console.error(
      `${i + 1}\t${l.levelId}\t${l.D.toFixed(3)}\t${l.trap ? 'T' : '.'}\t${l.util.toFixed(2)}\t${l.press}\t${l.length}`,
    ),
  );
}

// Curve A — sawtooth/flat: target within each cycle is its phase 0..1; cycles
// are equivalent. Stable sort of positions by target (ascending position on
// ties) -> the k-th easiest level fills the k-th lowest-target position.
const targetOf = (pos: number) => (pos % CYCLE) / (CYCLE - 1);
const positionsByTarget = [...Array(N).keys()].sort((a, b) => targetOf(a) - targetOf(b) || a - b);
const order: string[] = new Array(N);
ranked.forEach((lvl, k) => {
  order[positionsByTarget[k]] = lvl.levelId;
});

// Reporting: realized-difficulty sparkline + per-cycle listing.
const rankOf = new Map(ranked.map((l, i) => [l.levelId, i]));
const trapOf = new Map(lvls.map((l) => [l.levelId, l.trap]));
const spark = '▁▂▃▄▅▆▇█';
const line = order.map((id) => spark[Math.min(7, Math.floor((rankOf.get(id)! * 8) / N))]).join('');
console.log(line + '\n');
for (let c = 0; c * CYCLE < N; c++) {
  const cells = order
    .slice(c * CYCLE, c * CYCLE + CYCLE)
    .map((id) => `${id}${trapOf.get(id) ? '*' : ''}`.padStart(8));
  console.log(`cyc${String(c + 1).padStart(2)}:${cells.join('')}`);
}

if (!orderFile) {
  console.log('\n(no orderFile given — dry run only)');
  process.exit(0);
}

const raw = readFileSync(resolve(orderFile), 'utf-8');
const existing = JSON.parse(raw) as string[];
const samePermutation = [...existing].sort().join('|') === [...order].sort().join('|');
if (!samePermutation) {
  console.error('\nABORT: new order is not a pure permutation of the existing order file.');
  console.error('  missing: ' + existing.filter((x) => !order.includes(x)).join(', '));
  console.error('  extra:   ' + order.filter((x) => !existing.includes(x)).join(', '));
  process.exit(1);
}

const serialized = '[\n' + order.map((id) => JSON.stringify(id)).join(',\n') + '\n]' + (raw.endsWith('\n') ? '\n' : '');
if (WRITE) {
  writeFileSync(resolve(orderFile), serialized);
  console.log(`\n[written] ${orderFile} — ${order.length} levels reordered.`);
} else {
  console.log(`\n[dry-run] ${order.length} levels · permutation OK. Re-run with --write to apply.`);
}
