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
import { analyzeGreedyLevel } from '../src/editor/solver/greedy';
import { analyzeWasteGreedyLevel } from '../src/editor/solver/wasteGreedy';
import type { LevelData } from '../src/types';

// Keep the web play-order mirror (src/levels/order.json) in lockstep with the
// Unity order file this script writes, so the editor/game never drift from it.
const WEB_ORDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels', 'order.json');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const LIMITS_ONLY = argv.includes('--limits-only'); // keep the existing play order; only re-size movesLimits
const curveName = (argv.find((a) => a.startsWith('--curve=')) ?? '').split('=')[1] || 'sawtooth';
const spareArg = (argv.find((a) => a.startsWith('--spare=')) ?? '').split('=')[1];
const SPARE = spareArg === undefined ? 0 : Math.max(0, Math.floor(Number(spareArg))); // moves of cushion above the competent line on tightened levels (0 = competent cost, playtested)
const fumbleArg = (argv.find((a) => a.startsWith('--fumble=')) ?? '').split('=')[1];
const BETA = fumbleArg === undefined ? 0.5 : Math.max(0, Number(fumbleArg)); // expected wasted moves per card from the wrong-match penalty (fumble rate)
const floorArg = (argv.find((a) => a.startsWith('--fumble-floor=')) ?? '').split('=')[1];
const FUMBLE_FLOOR = floorArg === undefined ? 5 : Math.max(0, Math.floor(Number(floorArg))); // minimum fumble cushion any winnable level gets
const positional = argv.filter((a) => !a.startsWith('--'));
const levelsDir = positional[0];
const orderFile = positional[1];
if (!levelsDir) {
  console.error('usage: tune-levels.ts <levelsDir> [orderFile] [--write] [--limits-only] [--fumble=B] [--fumble-floor=N] [--spare=N] [--curve=NAME]');
  process.exit(1);
}

// Fumble cushion: every card on the level is a chance to mis-drop onto a wrong
// locked slot (each costs a move), so the allowance scales with card count.
const fumbleAllowance = (cards: number) => Math.max(FUMBLE_FLOOR, Math.ceil(BETA * cards));

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
  cards: number; // board + stock card count — fumble opportunities
  D: number;
}

const numKey = (f: string) => Number(f.replace(/\D/g, '')) || 0;
const files = readdirSync(resolve(levelsDir))
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => numKey(a) - numKey(b));

const lvls: Lvl[] = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(join(levelsDir, file), 'utf-8')) as LevelData;
  const single = analyzeGreedyLevel(data);
  const waste = analyzeWasteGreedyLevel(data);
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
    cards: data.board.length + data.stock.length,
    D: 0,
  });
}

let order: Lvl[];
if (LIMITS_ONLY) {
  // Move-count accounting only: keep the existing play order, just re-derive
  // each level's tight/loose band from its current position and re-size limits.
  const orderPath = orderFile ?? WEB_ORDER;
  let ids: string[];
  try {
    ids = JSON.parse(readFileSync(resolve(orderPath), 'utf-8')) as string[];
  } catch {
    console.error(`ABORT: --limits-only needs a readable order file (got ${orderPath}).`);
    process.exit(1);
  }
  const byId = new Map(lvls.map((l) => [l.levelId, l]));
  order = ids.map((id) => byId.get(id)).filter((l): l is Lvl => l !== undefined);
  const inOrder = new Set(ids);
  const absent = lvls.filter((l) => !inOrder.has(l.levelId));
  if (absent.length) {
    console.warn(`[skip] ${absent.length} level(s) absent from order, left unchanged: ${absent.map((m) => m.levelId).join(', ')}`);
  }
} else {
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
  const Nr = ranked.length;

  // Curve target per position.
  const cycles = Math.ceil(Nr / CYCLE);
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

  const positionsByTarget = [...Array(Nr).keys()].sort((a, b) => targetOf(a) - targetOf(b) || a - b);
  order = new Array(Nr);
  ranked.forEach((lvl, k) => (order[positionsByTarget[k]] = lvl));
}
const N = order.length;

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
  const F = fumbleAllowance(lvl.cards);
  let newLimit: number;
  let cls: Cls;
  if (lvl.trap) {
    newLimit = lvl.oldLimit; // auto-pops by deck-cycling; unwinnable, so a fumble cushion is moot
    cls = 'trap';
  } else if (tight) {
    newLimit = (lvl.competent as number) + SPARE + F; // competent line + spare + fumble cushion
    cls = 'tightened';
  } else {
    newLimit = lvl.oldLimit + F; // keep the level's generous slack, top it up for fumbles
    cls = 'easy';
  }
  return { pos, cyclePos, lvl, tight, newLimit, cls };
});

// ---- Report ----
const tag = (s: Slot) => `${s.lvl.levelId}${s.lvl.trap ? '*' : ''}`;
const modeLabel = LIMITS_ONLY ? 'limits-only (order preserved)' : `curve: ${curveName}`;
console.log(`${modeLabel}   mask: easy-tight-easy-tight-tight   fumble: β=${BETA}/card floor ${FUMBLE_FLOOR}   tight spare: +${SPARE}   (* board-driven trap)\n`);
for (let c = 0; c * CYCLE < N; c++) {
  const row = slots.slice(c * CYCLE, c * CYCLE + CYCLE).map((s) => {
    const lim = s.cls === 'trap' ? `${s.newLimit}!` : s.newLimit === s.lvl.oldLimit ? `${s.newLimit}` : `${s.lvl.oldLimit}→${s.newLimit}`;
    return `${tag(s)} [${s.tight ? 'T' : 'e'} ${lim}]`.padEnd(20);
  });
  console.log(`cyc${String(c + 1).padStart(2)}: ${row.join('')}`);
}

const tightened = slots.filter((s) => s.cls === 'tightened');
const traps = slots.filter((s) => s.cls === 'trap');
const changedSlots = slots.filter((s) => s.newLimit !== s.lvl.oldLimit).sort((a, b) => a.pos - b.pos);
console.log('\nMove-limit changes:');
for (const s of changedSlots) {
  const F = fumbleAllowance(s.lvl.cards);
  const basis = s.cls === 'tightened'
    ? `competent ${s.lvl.competent} + ${SPARE} spare + ${F} fumble`
    : `old ${s.lvl.oldLimit} + ${F} fumble`;
  console.log(`  ${s.lvl.levelId.padEnd(7)} pos ${String(s.pos + 1).padStart(2)} ${s.cls === 'tightened' ? 'T' : 'e'} ${String(s.lvl.cards).padStart(2)}c  ${String(s.lvl.oldLimit).padStart(3)} → ${String(s.newLimit).padStart(3)}  (${basis})`);
}

const popLevels = slots.filter((s) => s.cls === 'tightened' || s.cls === 'trap').length;
console.log(
  `\nprojected popup levels: ${popLevels}/${N} (${tightened.length} tightened + ${traps.length} trap auto-pop)` +
    ` = once per ${(N / popLevels).toFixed(2)} levels`,
);
console.log(`(every winnable level now carries a β=${BETA}/card fumble cushion, floor ${FUMBLE_FLOOR}; a tightened level pops only when a player wastes more than that.)`);
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
  console.log(`\n[dry-run] no files changed. Re-run with --write to apply ${LIMITS_ONLY ? 'move limits' : 'order + move limits'}.`);
  process.exit(0);
}

// Write the order file (preserve one-id-per-line format) — skipped in
// limits-only mode, which keeps the existing play order untouched.
if (!LIMITS_ONLY) {
  if (!orderFile) {
    console.error('ABORT: --write needs an orderFile argument.');
    process.exit(1);
  }
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
}
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
console.log(`\n[written] ${LIMITS_ONLY ? '' : 'order file + '}${changed} level movesLimit changes.`);
