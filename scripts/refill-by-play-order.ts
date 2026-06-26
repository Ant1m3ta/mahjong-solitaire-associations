// Re-fill level CATEGORY CONTENT so the category_list progression follows PLAY
// order (the order file), not filename order. IMAGE-SAFE: a category that renders
// as pictures (every word has `icon`) is kept verbatim — its tokens aren't in the
// text catalog — and only the TEXT categories are re-themed from category_list in
// play order. Image slots still consume their play-position index, so a text slot
// lands on the same category_list entry base-fill would give that position.
// Structure-preserving: move limits, slot counts, board/stock layout, difficulty
// tags and the play order itself are untouched; only text categories change.
//
//   npx tsx scripts/refill-by-play-order.ts <levelsDir> [orderFile] [--generate] [--write]
//     orderFile   play-order array (default: src/levels/order.json, the web mirror)
//     --generate  AI-generate words for short text categories (shells to `claude`,
//                 grows src/editor/catalog/words.json — same as the dev middleware)
//     --write     write the level files in place
//   default: dry-run (reports per-level assignment + shortfall, no AI, no writes)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pools, addCatalogWords } from '../src/editor/fill';
import { rewriteCategories, simpleTileCounts } from '../src/editor/rewrite';
import categoryListRaw from '../src/editor/catalog/category_list.json';
import {
  buildWordGenPrompt,
  WORD_GEN_MODEL,
  WORD_GEN_SCHEMA,
  type WordGenReq,
} from '../src/editor/wordGenPrompt';
import type { LevelData } from '../src/types';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDS_PATH = resolve(__dirname, '..', 'src', 'editor', 'catalog', 'words.json');
const GEN_BUFFER = 2; // ask for a couple extra to absorb dedup/avoid collisions
const CATEGORY_LIST = categoryListRaw as string[];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// A category renders as pictures when every word carries `icon`; its picture
// tokens live in the image catalog (not the text catalog), so it is kept verbatim
// rather than re-themed. Mirrors batchFix.ts / imageSwap.ts.
const isImageCategory = (cat: LevelData['categories'][number]): boolean =>
  cat.wordsData.length > 0 && cat.wordsData.every((w) => w.icon);

const argv = process.argv.slice(2);
const GENERATE = argv.includes('--generate');
const WRITE = argv.includes('--write');
const [levelsDir, orderFileArg] = argv.filter((a) => !a.startsWith('--'));
const orderFile = orderFileArg ?? resolve(__dirname, '..', 'src', 'levels', 'order.json');
if (!levelsDir) {
  console.error('usage: refill-by-play-order.ts <levelsDir> [orderFile] [--generate] [--write]');
  process.exit(1);
}

const order: string[] = JSON.parse(readFileSync(resolve(orderFile), 'utf-8'));
const byId = new Map<string, { file: string; level: LevelData }>();
for (const f of readdirSync(resolve(levelsDir)).filter((x) => x.endsWith('.json'))) {
  const level = JSON.parse(readFileSync(join(resolve(levelsDir), f), 'utf-8')) as LevelData;
  byId.set(level.levelId, { file: f, level });
}
const missingFiles = order.filter((id) => !byId.has(id));
if (missingFiles.length) {
  console.error(`ABORT: order references levels with no file — ${missingFiles.join(', ')}`);
  process.exit(1);
}

const wordsFor = (name: string): string[] => (pools().byId.get(name)?.wordsIds ?? []).slice();

interface CatPick { letter: string; categoryId: string; need: number; chosen: string[]; imaged: boolean }
interface LevelPlan { id: string; picks: CatPick[] }

// Walk play order with a running category_list cursor. Image categories are kept
// verbatim; only TEXT slots are re-themed from CATEGORY_LIST[cursor+i]. Image slots
// still advance the cursor so a text slot lands on the same list entry base-fill
// would assign that play position. Words are deduped against the level window
// (other chosen words + every window category name).
function assign(): LevelPlan[] {
  let cursor = 0;
  const out: LevelPlan[] = [];
  for (const id of order) {
    const orig = byId.get(id)!.level;
    const counts = simpleTileCounts(orig);
    const imaged = orig.categories.map((c) => isImageCategory(c));
    const reserved = new Set<string>();
    orig.categories.forEach((c, i) => {
      const n = imaged[i] ? c.categoryId : CATEGORY_LIST[cursor + i];
      if (n) reserved.add(n.toLowerCase());
    });
    const used = new Set<string>();
    const picks: CatPick[] = orig.categories.map((c, i) => {
      const letter = LETTERS[i];
      if (imaged[i]) {
        return { letter, categoryId: c.categoryId, need: counts[i], chosen: [], imaged: true };
      }
      const categoryId = CATEGORY_LIST[cursor + i];
      const chosen: string[] = [];
      for (const w of wordsFor(categoryId)) {
        if (chosen.length >= counts[i]) break;
        const k = w.toLowerCase();
        if (used.has(k) || reserved.has(k)) continue;
        used.add(k);
        chosen.push(w);
      }
      return { letter, categoryId, need: counts[i], chosen, imaged: false };
    });
    out.push({ id, picks });
    cursor += orig.categories.length;
  }
  return out;
}

const shortOf = (plan: LevelPlan[]): CatPick[] =>
  plan.flatMap((l) => l.picks).filter((p) => !p.imaged && p.chosen.length < p.need);

type GenReq = WordGenReq;

async function runClaude(prompt: string): Promise<{ categoryId: string; words: string[] }[]> {
  const { stdout } = await execFileAsync(
    'claude',
    ['-p', prompt, '--model', WORD_GEN_MODEL, '--output-format', 'json', '--json-schema', WORD_GEN_SCHEMA],
    { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout);
  if (!parsed.structured_output || !Array.isArray(parsed.structured_output.categories)) {
    throw new Error('claude returned no structured_output.categories');
  }
  return parsed.structured_output.categories;
}

function persistToCatalog(results: { categoryId: string; words: string[] }[]): number {
  const catalog = JSON.parse(readFileSync(WORDS_PATH, 'utf8')) as { categoryId: string; wordsIds: string[] }[];
  const idMap = new Map(catalog.map((c) => [c.categoryId, c]));
  let added = 0;
  for (const { categoryId, words } of results) {
    let entry = idMap.get(categoryId);
    if (!entry) {
      entry = { categoryId, wordsIds: [] };
      idMap.set(categoryId, entry);
      catalog.push(entry);
    }
    const seen = new Set(entry.wordsIds.map((w) => w.toLowerCase()));
    for (const w of words) {
      const k = w.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        entry.wordsIds.push(w);
        added++;
      }
    }
  }
  if (added > 0) writeFileSync(WORDS_PATH, JSON.stringify(catalog, null, 2) + '\n');
  return added;
}

async function main(): Promise<void> {
  let plan = assign();
  let short = shortOf(plan);
  const slots = plan.reduce((n, l) => n + l.picks.length, 0);
  const allPicks = plan.flatMap((l) => l.picks);
  const textCount = allPicks.filter((p) => !p.imaged).length;
  console.log(
    `play order: ${order.length} levels · ${textCount} text slots re-themed from category_list[0..${slots - 1}]` +
      ` · ${allPicks.length - textCount} image slots preserved · ${short.length} short`,
  );

  if (short.length > 0 && GENERATE) {
    const byCat = new Map<string, GenReq>();
    for (const p of short) {
      const count = p.need - p.chosen.length + GEN_BUFFER;
      const prev = byCat.get(p.categoryId);
      if (prev) prev.count = Math.max(prev.count, count);
      else byCat.set(p.categoryId, { categoryId: p.categoryId, count, existing: wordsFor(p.categoryId) });
    }
    const requests = [...byCat.values()];
    console.log(`\ngenerating words for ${requests.length} categories (${requests.reduce((n, r) => n + r.count, 0)} requested)…`);
    const results = await runClaude(buildWordGenPrompt(requests));
    for (const r of results) addCatalogWords(r.categoryId, r.words);
    const persisted = persistToCatalog(results);
    console.log(`generated ${results.reduce((n, r) => n + r.words.length, 0)} words · persisted ${persisted} new to words.json`);
    plan = assign();
    short = shortOf(plan);
  }

  if (short.length > 0) {
    console.log(`\nresidual shortfall (${short.length} slots — padded with placeholders${GENERATE ? '' : '; pass --generate'}):`);
    console.log(short.map((p) => `${p.categoryId} ${p.chosen.length}/${p.need}`).join('  ·  '));
  }

  // Final per-level assignment (text categories in play order; image slots kept).
  plan.forEach((l, i) => {
    const text = l.picks.filter((p) => !p.imaged).map((p) => p.categoryId);
    const img = l.picks.filter((p) => p.imaged).map((p) => p.categoryId);
    console.log(`  ${String(i + 1).padStart(2)}. ${l.id.padEnd(6)} ${text.join(', ')}${img.length ? `  [img: ${img.join(', ')}]` : ''}`);
  });

  // Re-theme TEXT categories in place (text-only). Image categories and the
  // board/stock cardIds pointing into them are left verbatim — no splice needed.
  const filled = plan.map((l) => {
    const orig = byId.get(l.id)!.level;
    const rewrites = l.picks
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.imaged)
      .map(({ p, i }) => ({ index: i, categoryId: p.categoryId, words: p.chosen }));
    const out = rewriteCategories(orig, rewrites, { textOnly: true });
    return { file: byId.get(l.id)!.file, level: out };
  });

  if (WRITE) {
    for (const f of filled) writeFileSync(join(resolve(levelsDir), f.file), JSON.stringify(f.level, null, 2) + '\n');
    console.log(`\n[written] ${filled.length} level files (play-order text categories; images, limits, layout, order preserved).`);
  } else {
    console.log(`\n[dry-run] filled ${filled.length} levels in memory. Re-run with --generate --write to apply.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
