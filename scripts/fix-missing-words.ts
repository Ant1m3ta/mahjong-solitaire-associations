// Fix levels that still carry placeholder stubs: fill each short category from
// the word catalog where possible (theme preserved), else REPLACE it with a
// random valid catalog category that has enough words. Image categories are
// left untouched. Every resulting level is validated so categories and words
// never cross (no word equals a category name, no word shared across
// categories, every board/stock cardId resolves).
//
//   npx tsx scripts/fix-missing-words.ts <levelsDir> [--write] [--seed=N]
//     default: dry-run (prints the per-level plan, writes nothing)
//     --write: rewrite each changed level file (2-space JSON)
//     --seed=N: seed the replacement RNG (default 1) so the plan is reproducible
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pools } from '../src/editor/fill';
import { rewriteCategories, simpleTileCounts, type CategoryRewrite } from '../src/editor/rewrite';
import type { LevelData } from '../src/types';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const SEED = Number((argv.find((a) => a.startsWith('--seed=')) ?? '--seed=1').split('=')[1]) || 1;
const dir = argv.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: fix-missing-words.ts <levelsDir> [--write] [--seed=N]');
  process.exit(1);
}
const DIR = resolve(dir);

const isImg = (c: any) => c.wordsData.length > 0 && c.wordsData.every((w: any) => w.icon);
const wordsFor = (n: string): string[] => (pools().byId.get(n)?.wordsIds ?? []).slice();

// Deterministic RNG (mulberry32) so a dry-run matches a later --write.
function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mkRng(SEED);
const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Pick up to `need` words for a category, skipping used words + reserved names.
function pickWords(name: string, need: number, used: Set<string>, reserved: Set<string>): string[] {
  const out: string[] = [];
  for (const w of wordsFor(name)) {
    if (out.length >= need) break;
    const k = w.toLowerCase();
    if (used.has(k) || reserved.has(k)) continue;
    out.push(w);
  }
  return out;
}

const files = readdirSync(DIR).filter((x) => x.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const levels = files.map((f) => ({ f, level: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as LevelData }));

// Names already in play anywhere (so a replacement theme is new to the game),
// plus replacements chosen so far (unique across the batch).
const taken = new Set<string>();
for (const { level } of levels) for (const c of level.categories) taken.add(c.categoryId.toLowerCase());

interface Change { kind: 'fill' | 'replace'; orig: string; to?: string; got: number; need: number; newWords: string[] }

let changedFiles = 0, fillN = 0, replaceN = 0, problems = 0;

for (const { f, level } of levels) {
  const name = f.replace('.json', '');
  const counts = simpleTileCounts(level);
  const reserved = new Set<string>(level.categories.map((c) => c.categoryId.toLowerCase()));
  const used = new Set<string>();
  const changes: Change[] = [];
  // Only the filled/replaced slots are rewritten; image + complete text
  // categories are left verbatim (absent from `rewrites`), so the diff is the fix.
  const rewrites: CategoryRewrite[] = [];

  level.categories.forEach((cat, i) => {
    if (isImg(cat)) return; // untouched
    const need = counts[i];
    const existingReal = new Set(cat.wordsData.filter((w) => !w.missing).map((w) => w.wordId.toLowerCase()));
    const words = pickWords(cat.categoryId, need, used, reserved);
    if (words.length >= need) {
      const stubs = cat.wordsData.filter((w) => w.missing).length;
      if (stubs > 0) {
        const fresh = words.filter((w) => !existingReal.has(w.toLowerCase()));
        changes.push({ kind: 'fill', orig: cat.categoryId, got: need, need, newWords: fresh });
        rewrites.push({ index: i, categoryId: cat.categoryId, words });
        fillN++;
      }
      words.forEach((w) => used.add(w.toLowerCase()));
      return; // complete category: reserve its words, keep verbatim
    }
    // REPLACE: random valid catalog category, unique to the game, fills cleanly.
    const cands = shuffle(pools().all.filter((c) => c.wordsIds.length >= need && !taken.has(c.categoryId.toLowerCase())));
    let chosen: { id: string; words: string[] } | null = null;
    for (const c of cands) {
      const w = pickWords(c.categoryId, need, used, reserved);
      if (w.length >= need) { chosen = { id: c.categoryId, words: w }; break; }
    }
    if (!chosen) {
      changes.push({ kind: 'replace', orig: cat.categoryId, to: '(NO CANDIDATE)', got: words.length, need, newWords: [] });
      problems++;
      return; // can't fix; keep verbatim
    }
    taken.add(chosen.id.toLowerCase());
    reserved.add(chosen.id.toLowerCase());
    chosen.words.forEach((w) => used.add(w.toLowerCase()));
    changes.push({ kind: 'replace', orig: cat.categoryId, to: chosen.id, got: words.length, need, newWords: chosen.words });
    rewrites.push({ index: i, categoryId: chosen.id, words: chosen.words });
    replaceN++;
  });

  if (changes.length === 0) continue;
  changedFiles++;

  // Rewrite only the filled/replaced slots in place; image + complete text
  // categories (and their cardIds) are left verbatim, so the diff is the fix.
  const out = rewriteCategories(level, rewrites);

  // Validate: no word == a category name, no word shared across categories,
  // and every board/stock cardId resolves to a category or a known word.
  const catIds = new Set(out.categories.map((c) => c.categoryId.toLowerCase()));
  const wordOwner = new Map<string, string>();
  const issues: string[] = [];
  out.categories.forEach((c) => {
    for (const w of c.wordsData) {
      if (w.icon) continue; // image tokens are namespaced; can't cross
      const k = w.wordId.toLowerCase();
      if (catIds.has(k)) issues.push(`word "${w.wordId}" == a category name`);
      const prev = wordOwner.get(k);
      if (prev && prev !== c.categoryId) issues.push(`word "${w.wordId}" in both ${prev} & ${c.categoryId}`);
      else wordOwner.set(k, c.categoryId);
    }
  });
  const allWordIds = new Set(out.categories.flatMap((c) => c.wordsData.map((w) => w.wordId.toLowerCase())));
  for (const ref of [...out.board.map((b) => b.cardId), ...out.stock]) {
    const k = ref.toLowerCase();
    if (!catIds.has(k) && !allWordIds.has(k)) issues.push(`cardId "${ref}" resolves to nothing`);
  }
  const stillStub = out.categories.some((c) => c.wordsData.some((w) => w.missing) || c.incomplete);
  if (stillStub) issues.push('still has placeholder/incomplete markers');
  if (issues.length) problems++;

  // Report.
  console.log(name + ':');
  for (const ch of changes) {
    if (ch.kind === 'fill') console.log(`  FILL    ${ch.orig} (+${ch.newWords.length} stub${ch.newWords.length === 1 ? '' : 's'}): ${ch.newWords.join(', ')}`);
    else console.log(`  REPLACE ${ch.orig} (${ch.got}/${ch.need}) -> ${ch.to}: ${ch.newWords.join(', ')}`);
  }
  console.log(issues.length ? `  ✗ ${[...new Set(issues)].join(' | ')}` : '  ✓ valid');

  if (WRITE) writeFileSync(join(DIR, f), JSON.stringify(out, null, 2));
}

console.log(`\n${changedFiles} level${changedFiles === 1 ? '' : 's'} changed · ${fillN} filled · ${replaceN} replaced · ${problems} problem${problems === 1 ? '' : 's'}` + (WRITE ? ' · WRITTEN' : ' · dry-run (no writes)'));
