// Re-apply tune-levels' tightness mask at the CURRENT play order (no re-order).
// For levels whose competent cost changed (e.g. after a slot reduction / board
// edit), this resets movesLimit on tight cycle positions (2,4,5) to competent +
// SPARE, leaving generous positions (1,3) and board-driven traps alone. Unlike
// tune-levels.ts it never touches the order files. Dry-run unless --write.
//   npx tsx scripts/tighten-in-place.ts <levelsDir> [orderFile] [--write] [--spare=N]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unfillLevel } from '../src/editor/unfill';
import { analyzeGreedySkeleton } from '../src/editor/solver/greedy';
import { analyzeWasteGreedySkeleton } from '../src/editor/solver/wasteGreedy';
import type { LevelData } from '../src/types';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const spareArg = (argv.find((a) => a.startsWith('--spare=')) ?? '').split('=')[1];
const SPARE = spareArg === undefined ? 0 : Math.max(0, Math.floor(Number(spareArg)));
const onlyArg = (argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1];
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null; // restrict to these levelIds
const positional = argv.filter((a) => !a.startsWith('--'));
const levelsDir =
  positional[0] ??
  '/Users/caspar/Documents/Dev/StripedArts/SoliJong/unity/soli-jong/Assets/Code/Common/Feature/SoliJong/Levels';
const orderFile =
  positional[1] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels', 'order.json');

const CYCLE = 5;
const TIGHT = new Set([2, 4, 5]); // 1-based cycle position; easy-tight-easy-tight-tight

const order = JSON.parse(readFileSync(resolve(orderFile), 'utf-8')) as string[];
const posOf = new Map(order.map((id, i) => [id, i]));

const files = readdirSync(resolve(levelsDir)).filter((f) => f.endsWith('.json'));

interface Change {
  levelId: string;
  file: string;
  pos: number;
  cyc: number;
  oldLimit: number;
  newLimit: number;
  competent: number;
}
const changes: Change[] = [];
const skippedNoPos: string[] = [];
const trapsTight: string[] = [];

for (const file of files) {
  const data = JSON.parse(readFileSync(join(levelsDir, file), 'utf-8')) as LevelData;
  if (ONLY && !ONLY.has(data.levelId)) continue;
  const pos = posOf.get(data.levelId);
  if (pos === undefined) {
    skippedNoPos.push(data.levelId);
    continue;
  }
  const cyc = (pos % CYCLE) + 1;
  if (!TIGHT.has(cyc)) continue; // generous position — leave it

  const skel = unfillLevel(data);
  const single = analyzeGreedySkeleton(skel);
  const waste = analyzeWasteGreedySkeleton(skel);
  if (single.outcome === 'invalid' || waste.outcome === 'invalid') {
    console.error(`ABORT: ${file} invalid — ${waste.message ?? single.message}`);
    process.exit(1);
  }
  const trap = single.outcome === 'softlock' && waste.outcome === 'softlock';
  if (trap) {
    trapsTight.push(data.levelId); // auto-pops; budget left alone
    continue;
  }
  const competent = waste.outcome === 'won' ? waste.movesUsed : single.outcome === 'won' ? single.movesUsed : null;
  if (competent === null) continue;
  const newLimit = competent + SPARE;
  if (newLimit !== data.movesLimit) {
    changes.push({ levelId: data.levelId, file, pos, cyc, oldLimit: data.movesLimit, newLimit, competent });
  }
}

changes.sort((a, b) => a.pos - b.pos);
console.log(`\n=== Tighten-in-place (spare +${SPARE}, current order, no re-order) — ${WRITE ? 'WRITING' : 'dry-run'} ===\n`);
if (!changes.length) console.log('  No tight-position level is off its competent line. Nothing to do.');
for (const c of changes) {
  const dir = c.newLimit < c.oldLimit ? 'tighten' : 'raise';
  console.log(`  ${c.levelId.padEnd(7)} pos ${String(c.pos + 1).padStart(2)} cyc${c.cyc}  ${String(c.oldLimit).padStart(3)} → ${String(c.newLimit).padStart(3)}  (${dir}, competent ${c.competent}+${SPARE})`);
}
if (trapsTight.length) console.log(`\n  tight board-traps left as-is (auto-pop): ${trapsTight.join(', ')}`);
if (skippedNoPos.length) console.log(`  not in order file (skipped): ${skippedNoPos.join(', ')}`);

if (WRITE) {
  let n = 0;
  for (const c of changes) {
    const path = join(levelsDir, c.file);
    const raw = readFileSync(path, 'utf-8');
    const replaced = raw.replace(/("movesLimit"\s*:\s*)-?\d+/, `$1${c.newLimit}`);
    if (replaced === raw) {
      console.error(`ABORT: could not rewrite movesLimit in ${c.file}`);
      process.exit(1);
    }
    writeFileSync(path, replaced);
    n++;
  }
  console.log(`\n[written] ${n} movesLimit changes (surgical; order files untouched).`);
} else {
  console.log('\n[dry-run] no files changed. Re-run with --write to apply.');
}
