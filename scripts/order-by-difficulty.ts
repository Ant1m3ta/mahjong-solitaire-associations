// Re-optimize the level play-order into a difficulty curve. Repeatable: drop new
// level files into <levelsDir>, re-run, and the whole sequence is re-scored and
// re-ordered. The order file is reconciled against the files actually present —
// new levels are picked up, deleted ones are dropped — so this is safe to run at
// will as the level set grows.
//
// Difficulty per level is composed from the existing analyzers:
//   * foresight wall  — straightforward (greedy) player softlocks  -> top band
//   * execution tight — A* optimal moves / authored move limit
//   * cognitive load  — categories minus parallel slots
//   D = 0.5*tight + 0.3*load + 0.2*length  (softlocks forced to the top band)
// The metric yields a difficulty RANKING; the curve is a lossless permutation of
// that ranking onto positions.
//
//   npx tsx scripts/order-by-difficulty.ts <levelsDir> [orderFile] [flags]
//     --write           apply the new order to orderFile (default: dry run)
//     --skip-invalid    exclude broken/unsolvable levels instead of aborting
//     --curve=NAME      sawtooth (default) | sawtooth-rising | sine-rising
//
// orderFile is the Unity level-order array (a JSON list of levelIds loaded by
// LevelOrderProvider; array position = play order). DEBUG_RANK=1 dumps the
// per-level ranking to stderr.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeGreedySkeleton } from '../src/editor/solver/greedy';
import { solveSkeleton } from '../src/editor/solver/solverCore';
import type { LevelData } from '../src/types';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const SKIP_INVALID = argv.includes('--skip-invalid');
const curveName = (argv.find((a) => a.startsWith('--curve=')) ?? '').split('=')[1] || 'sawtooth';
const positional = argv.filter((a) => !a.startsWith('--'));
const levelsDir = positional[0];
const orderFile = positional[1];
if (!levelsDir) {
  console.error(
    'usage: order-by-difficulty.ts <levelsDir> [orderFile] [--write] [--skip-invalid] [--curve=sawtooth|sawtooth-rising|sine-rising]',
  );
  process.exit(1);
}

const CYCLE = 5;
const SOLVE_OPTS = { maxStates: 300_000, maxMs: 8000 }; // ~bounds A* per level

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
const problems: { file: string; reason: string }[] = [];
const timeouts: string[] = [];

for (const file of files) {
  let data: LevelData;
  try {
    data = JSON.parse(readFileSync(resolve(levelsDir, file), 'utf-8')) as LevelData;
  } catch (e) {
    problems.push({ file, reason: `parse error — ${(e as Error).message}` });
    continue;
  }
  let skel;
  try {
    skel = unfillLevel(data);
  } catch (e) {
    problems.push({ file, reason: `unfill error — ${(e as Error).message}` });
    continue;
  }
  const greedy = analyzeGreedySkeleton(skel);
  const opt = solveSkeleton(skel, SOLVE_OPTS);
  if (opt.status === 'unsolvable') {
    problems.push({ file, reason: 'A* proved the level unsolvable (broken level)' });
    continue;
  }
  if (opt.status === 'timeout') timeouts.push(data.levelId);
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

const dupIds = [...new Set(lvls.map((l) => l.levelId).filter((id, i, a) => a.indexOf(id) !== i))];
if (dupIds.length) {
  console.error(`ABORT: duplicate levelId(s) across files — ${dupIds.join(', ')}`);
  process.exit(1);
}

if (problems.length) {
  console.error(`\n${problems.length} problem level(s):`);
  for (const p of problems) console.error(`  ${p.file}: ${p.reason}`);
  if (!SKIP_INVALID) {
    console.error('\nABORT: fix these, or re-run with --skip-invalid to drop them from the order.');
    process.exit(1);
  }
  console.error('\n--skip-invalid: dropping the above from the order.');
}

if (lvls.length === 0) {
  console.error('ABORT: no valid levels found.');
  process.exit(1);
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

// Difficulty target per position, by curve shape. phase ramps 0->1 within each
// 5-level cycle; baseline ramps 0->1 across cycles (rising variants only).
const cycles = Math.ceil(N / CYCLE);
const phase = (pos: number) => (pos % CYCLE) / (CYCLE - 1);
const baseline = (pos: number) => (cycles > 1 ? Math.floor(pos / CYCLE) / (cycles - 1) : 0);
const hump = (pos: number) => (-Math.cos((2 * Math.PI * (pos % CYCLE)) / CYCLE) + 1) / 2;
const curves: Record<string, (pos: number) => number> = {
  sawtooth: phase, // each cycle ramps easy->hard, same band (the shipped curve)
  'sawtooth-rising': (pos) => 0.55 * baseline(pos) + 0.45 * phase(pos),
  'sine-rising': (pos) => 0.55 * baseline(pos) + 0.45 * hump(pos),
};
const targetOf = curves[curveName];
if (!targetOf) {
  console.error(`ABORT: unknown --curve=${curveName} (use ${Object.keys(curves).join(' | ')}).`);
  process.exit(1);
}

// Rank-match: the k-th easiest level fills the k-th lowest-target position.
const positionsByTarget = [...Array(N).keys()].sort((a, b) => targetOf(a) - targetOf(b) || a - b);
const order: string[] = new Array(N);
ranked.forEach((lvl, k) => {
  order[positionsByTarget[k]] = lvl.levelId;
});

// Reporting: realized-difficulty sparkline + per-cycle listing.
const rankOf = new Map(ranked.map((l, i) => [l.levelId, i]));
const trapOf = new Map(lvls.map((l) => [l.levelId, l.trap]));
const spark = '▁▂▃▄▅▆▇█';
console.log(`curve: ${curveName}\n`);
console.log(order.map((id) => spark[Math.min(7, Math.floor((rankOf.get(id)! * 8) / N))]).join('') + '\n');
for (let c = 0; c * CYCLE < N; c++) {
  const cells = order
    .slice(c * CYCLE, c * CYCLE + CYCLE)
    .map((id) => `${id}${trapOf.get(id) ? '*' : ''}`.padStart(8));
  console.log(`cyc${String(c + 1).padStart(2)}:${cells.join('')}`);
}

// Reconcile against the current order file (informational diff).
let existing: string[] = [];
let raw = '';
if (orderFile) {
  try {
    raw = readFileSync(resolve(orderFile), 'utf-8');
    existing = JSON.parse(raw) as string[];
  } catch {
    /* missing/new order file — treated as empty */
  }
}
const added = order.filter((id) => !existing.includes(id));
const dropped = existing.filter((id) => !order.includes(id));
const moved = existing.length ? order.filter((id, i) => existing[i] !== id).length : N;
const traps = lvls.filter((l) => l.trap).length;
console.log(
  `\nsummary: ${N} levels · ${traps} trap${traps === 1 ? '' : 's'}` +
    ` · added ${added.length}${added.length ? ` [${added.join(', ')}]` : ''}` +
    ` · dropped ${dropped.length}${dropped.length ? ` [${dropped.join(', ')}]` : ''}` +
    ` · ${moved}/${N} positions changed` +
    (timeouts.length ? ` · A* timeout, approx score [${timeouts.join(', ')}]` : ''),
);

if (!orderFile) {
  console.log('\n(no orderFile given — dry run only)');
  process.exit(0);
}

const serialized = '[\n' + order.map((id) => JSON.stringify(id)).join(',\n') + '\n]' + (raw === '' || raw.endsWith('\n') ? '\n' : '');
if (WRITE) {
  writeFileSync(resolve(orderFile), serialized);
  console.log(`\n[written] ${orderFile} — ${N} levels.`);
  console.log(
    'note: this changes which level sits at each play index — a returning player’s saved progress index now points at a different level. Fine pre-launch; for a live build prefer appending new levels over a full re-optimization.',
  );
} else {
  console.log(`\n[dry-run] re-run with --write to apply to ${orderFile}.`);
}
