// Difficulty optimization + move-limit tuning, waste-model accurate. Dry-run by
// default — prints the proposed order and every old->new movesLimit; --write
// applies (rewrites the order file AND each level's movesLimit).
//
//   npx tsx scripts/tune-levels.ts <levelsDir> [orderFile] [--write] [--curve=NAME]
//
// Pipeline:
//  1. Rank by INTRINSIC difficulty (move-budget independent): board-driven trap
//     (softlocks under BOTH the single-card and the faithful waste-pile greedy)
//     -> top band; else 0.6*(categories-slots) + 0.4*(competent move cost).
//  2. Lay onto the curve (sawtooth: each 5-level cycle ramps easy->hard).
//  3. Per cycle apply the tightness mask easy-tight-easy-tight-tight (positions
//     1 & 3 stay generous; 2,4,5 are tightened). A tightened WINNABLE level gets
//     movesLimit = competent (greedy) move cost + a spare cushion (--spare, default
//     0 = competent cost, so any wasted move hits the out-of-moves popup; raise
//     --spare for a more forgiving cushion). A board-driven trap is
//     left as-is (it auto-pops: the player burns moves cycling a deck it can't
//     clear). Generous positions are untouched.
//
// Competent cost = waste-pile greedy moves (the real game's hand mechanic); for a
// level the waste greedy can't finish but the single-card greedy can, the
// single-card count is used as a safe (slightly loose) fallback.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeGreedySkeleton } from '../src/editor/solver/greedy';
import { analyzeWasteGreedySkeleton } from '../src/editor/solver/wasteGreedy';
import type { LevelData } from '../src/types';

// Keep the web play-order mirror (src/levels/order.json) in lockstep with the
// Unity order file this script writes, so the editor/game never drift from it.
const WEB_ORDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels', 'order.json');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const curveName = (argv.find((a) => a.startsWith('--curve=')) ?? '').split('=')[1] || 'sawtooth';
const spareArg = (argv.find((a) => a.startsWith('--spare=')) ?? '').split('=')[1];
const SPARE = spareArg === undefined ? 0 : Math.max(0, Math.floor(Number(spareArg))); // moves of cushion above the competent line on tightened levels (0 = competent cost, playtested)
const positional = argv.filter((a) => !a.startsWith('--'));
const levelsDir = positional[0];
const orderFile = positional[1];
if (!levelsDir) {
  console.error('usage: tune-levels.ts <levelsDir> [orderFile] [--write] [--spare=N] [--curve=NAME]');
  process.exit(1);
}

const CYCLE = 5;
const TIGHT = new Set([2, 4, 5]); // 1-based cycle position; easy-tight-easy-tight-tight

interface Lvl {
  levelId: string;
  file: string;
  oldLimit: number;
  cats: number;
  slots: number;
  trap: boolean; // board-driven: softlocks under BOTH hand models
  competent: number | null; // competent (greedy) move cost; null only for traps
  load: number;
  D: number;
}

const numKey = (f: string) => Number(f.replace(/\D/g, '')) || 0;
const files = readdirSync(resolve(levelsDir))
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => numKey(a) - numKey(b));

const lvls: Lvl[] = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(join(levelsDir, file), 'utf-8')) as LevelData;
  const skel = unfillLevel(data);
  const single = analyzeGreedySkeleton(skel);
  const waste = analyzeWasteGreedySkeleton(skel);
  if (single.outcome === 'invalid' || waste.outcome === 'invalid') {
    console.error(`ABORT: ${file} invalid — ${waste.message ?? single.message ?? '?'}`);
    process.exit(1);
  }
  const trap = single.outcome === 'softlock' && waste.outcome === 'softlock';
  const competent = waste.outcome === 'won' ? waste.movesUsed : single.outcome === 'won' ? single.movesUsed : null;
  lvls.push({
    levelId: data.levelId,
    file,
    oldLimit: data.movesLimit,
    cats: data.categories.length,
    slots: data.slotsDefault,
    trap,
    competent,
    load: data.categories.length - data.slotsDefault,
    D: 0,
  });
}

const norm = (vals: number[]) => {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);
};
const nLoad = norm(lvls.map((l) => l.load));
const lenVals = lvls.filter((l) => l.competent !== null).map((l) => l.competent as number);
const nLen = norm(lenVals);
for (const l of lvls) {
  if (l.trap) {
    l.D = 0.9 + 0.1 * nLoad(l.load); // top band, ordered among traps by load
  } else {
    const fair = 0.6 * nLoad(l.load) + 0.4 * nLen(l.competent as number);
    l.D = 0.85 * fair;
  }
}

// Stable easy->hard sort (numeric file order breaks ties).
const ranked = lvls.map((l, i) => ({ l, i })).sort((a, b) => a.l.D - b.l.D || a.i - b.i).map((x) => x.l);
const N = ranked.length;

// Curve target per position.
const cycles = Math.ceil(N / CYCLE);
const phase = (pos: number) => (pos % CYCLE) / (CYCLE - 1);
const baseline = (pos: number) => (cycles > 1 ? Math.floor(pos / CYCLE) / (cycles - 1) : 0);
const hump = (pos: number) => (-Math.cos((2 * Math.PI * (pos % CYCLE)) / CYCLE) + 1) / 2;
const curves: Record<string, (pos: number) => number> = {
  sawtooth: phase,
  'sawtooth-rising': (pos) => 0.55 * baseline(pos) + 0.45 * phase(pos),
  'sine-rising': (pos) => 0.55 * baseline(pos) + 0.45 * hump(pos),
};
const targetOf = curves[curveName];
if (!targetOf) {
  console.error(`ABORT: unknown --curve=${curveName} (use ${Object.keys(curves).join(' | ')}).`);
  process.exit(1);
}

const positionsByTarget = [...Array(N).keys()].sort((a, b) => targetOf(a) - targetOf(b) || a - b);
const order: Lvl[] = new Array(N);
ranked.forEach((lvl, k) => (order[positionsByTarget[k]] = lvl));

// Assign new move limits per position.
type Cls = 'easy' | 'tightened' | 'trap';
interface Slot {
  pos: number;
  cyclePos: number;
  lvl: Lvl;
  tight: boolean;
  newLimit: number;
  cls: Cls;
}
const slots: Slot[] = order.map((lvl, pos) => {
  const cyclePos = (pos % CYCLE) + 1;
  const tight = TIGHT.has(cyclePos);
  let newLimit = lvl.oldLimit;
  let cls: Cls = 'easy';
  if (tight) {
    if (lvl.trap) {
      cls = 'trap'; // auto-pops; leave the budget alone
    } else {
      newLimit = (lvl.competent as number) + SPARE; // competent line + SPARE-move cushion
      cls = 'tightened';
    }
  }
  return { pos, cyclePos, lvl, tight, newLimit, cls };
});

// ---- Report ----
const tag = (s: Slot) => `${s.lvl.levelId}${s.lvl.trap ? '*' : ''}`;
console.log(`curve: ${curveName}   mask: easy-tight-easy-tight-tight   tight spare: +${SPARE}   (* board-driven trap)\n`);
for (let c = 0; c * CYCLE < N; c++) {
  const row = slots.slice(c * CYCLE, c * CYCLE + CYCLE).map((s) => {
    const lim = s.cls === 'tightened' ? `${s.lvl.oldLimit}→${s.newLimit}` : s.cls === 'trap' ? `${s.newLimit}!` : `${s.newLimit}`;
    return `${tag(s)} [${s.tight ? 'T' : 'e'} ${lim}]`.padEnd(20);
  });
  console.log(`cyc${String(c + 1).padStart(2)}: ${row.join('')}`);
}

const tightened = slots.filter((s) => s.cls === 'tightened');
const traps = slots.filter((s) => s.cls === 'trap');
console.log('\nMove-limit changes (tightened levels):');
for (const s of tightened.sort((a, b) => a.pos - b.pos)) {
  console.log(`  ${s.lvl.levelId.padEnd(7)} pos ${String(s.pos + 1).padStart(2)}  ${String(s.lvl.oldLimit).padStart(3)} → ${String(s.newLimit).padStart(3)}  (competent ${s.lvl.competent} + ${SPARE})`);
}

const popLevels = slots.filter((s) => s.cls === 'tightened' || s.cls === 'trap').length;
console.log(
  `\nprojected popup levels: ${popLevels}/${N} (${tightened.length} tightened + ${traps.length} trap auto-pop)` +
    ` = once per ${(N / popLevels).toFixed(2)} levels`,
);
console.log(`(tightened levels carry a +${SPARE}-move cushion over the competent line; a player pops only by wasting more than ${SPARE} moves there.)`);
// Verify no two consecutive generous (would violate "once per 2").
let maxGap = 0;
let gap = 0;
for (const s of slots) {
  if (s.cls === 'easy') {
    gap++;
    maxGap = Math.max(maxGap, gap);
  } else gap = 0;
}
console.log(`longest run of generous (no-popup) levels in a row: ${maxGap}`);
console.log(
  `summary: ${N} levels · ${traps.length} board-driven traps · ${tightened.length} tightened · ${slots.filter((s) => s.cls === 'easy').length} left generous`,
);

if (!WRITE) {
  console.log('\n[dry-run] no files changed. Re-run with --write to apply order + move limits.');
  process.exit(0);
}

if (!orderFile) {
  console.error('ABORT: --write needs an orderFile argument.');
  process.exit(1);
}
// Write order file (preserve one-id-per-line format).
const rawOrder = (() => {
  try {
    return readFileSync(resolve(orderFile), 'utf-8');
  } catch {
    return '';
  }
})();
const serialized = '[\n' + order.map((l) => JSON.stringify(l.levelId)).join(',\n') + '\n]' + (rawOrder === '' || rawOrder.endsWith('\n') ? '\n' : '');
writeFileSync(resolve(orderFile), serialized);
writeFileSync(WEB_ORDER, serialized);
console.log(`[synced] ${WEB_ORDER} (web play-order mirror).`);
// Write changed move limits in place — surgical replacement of just the number,
// so the rest of each level file (formatting, key order) is byte-identical.
let changed = 0;
for (const s of slots) {
  if (s.newLimit === s.lvl.oldLimit) continue;
  const path = join(levelsDir, s.lvl.file);
  const raw = readFileSync(path, 'utf-8');
  const replaced = raw.replace(/("movesLimit"\s*:\s*)-?\d+/, `$1${s.newLimit}`);
  if (replaced === raw) {
    console.error(`ABORT: could not rewrite movesLimit in ${s.lvl.file}`);
    process.exit(1);
  }
  writeFileSync(path, replaced);
  changed++;
}
console.log(`\n[written] order file + ${changed} level movesLimit changes.`);
