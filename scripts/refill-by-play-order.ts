// Re-fill level CATEGORY CONTENT so the category_list progression follows PLAY
// order (the order file), not filename order. Structure-preserving: unfill →
// reassign categories by a cursor walking category_list in play order → text-only
// fill. Move limits, slot counts, board/stock layout, difficulty tags and the
// play order itself are all preserved; only category/word identities change.
//
//   npx tsx scripts/refill-by-play-order.ts <levelsDir> <orderFile> [--generate] [--write]
//     --generate  AI-generate words for short categories (shells to `claude`,
//                 grows src/editor/catalog/words.json — same as the dev middleware)
//     --write     write the 50 level files (text-only, no icon/imageId)
//   default: dry-run (reports assignment + shortfall, no AI, no writes)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unfillLevel } from '../src/editor/unfill';
import { pools, addCatalogWords, fillSkeleton } from '../src/editor/fill';
import categoryListRaw from '../src/editor/catalog/category_list.json';
import type { LevelData } from '../src/types';
import type { SkeletonLevel } from '../src/editor/types';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDS_PATH = resolve(__dirname, '..', 'src', 'editor', 'catalog', 'words.json');
const WORD_GEN_MODEL = 'claude-haiku-4-5';
const GEN_BUFFER = 2; // ask for a couple extra to absorb dedup/avoid collisions
const CATEGORY_LIST = categoryListRaw as string[];
const WORD_GEN_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: { categoryId: { type: 'string' }, words: { type: 'array', items: { type: 'string' } } },
        required: ['categoryId', 'words'],
        additionalProperties: false,
      },
    },
  },
  required: ['categories'],
  additionalProperties: false,
});

const argv = process.argv.slice(2);
const GENERATE = argv.includes('--generate');
const WRITE = argv.includes('--write');
const [levelsDir, orderFile] = argv.filter((a) => !a.startsWith('--'));
if (!levelsDir || !orderFile) {
  console.error('usage: refill-by-play-order.ts <levelsDir> <orderFile> [--generate] [--write]');
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

interface CatPick { letter: string; categoryId: string; need: number; chosen: string[] }
interface LevelPlan { id: string; skel: SkeletonLevel; picks: CatPick[] }

// Walk category_list in play order; pick each category's first `need` unique
// catalog words, deduped against the level's window (other chosen words and
// every window category name). Mirrors editor/rangeAssign.ts computeAssignments.
function assign(): LevelPlan[] {
  let cursor = 0;
  const out: LevelPlan[] = [];
  for (const id of order) {
    const skel = unfillLevel(byId.get(id)!.level);
    const cats = skel.categories;
    const reserved = new Set<string>();
    for (let i = 0; i < cats.length; i++) {
      const n = CATEGORY_LIST[cursor + i];
      if (n) reserved.add(n.toLowerCase());
    }
    const used = new Set<string>();
    const picks: CatPick[] = cats.map((c, i) => {
      const categoryId = CATEGORY_LIST[cursor + i];
      const chosen: string[] = [];
      for (const w of wordsFor(categoryId)) {
        if (chosen.length >= c.simpleCards) break;
        const k = w.toLowerCase();
        if (used.has(k) || reserved.has(k)) continue;
        used.add(k);
        chosen.push(w);
      }
      return { letter: c.letter, categoryId, need: c.simpleCards, chosen };
    });
    out.push({ id, skel, picks });
    cursor += cats.length;
  }
  return out;
}

const shortOf = (plan: LevelPlan[]): CatPick[] =>
  plan.flatMap((l) => l.picks).filter((p) => p.chosen.length < p.need);

interface GenReq { categoryId: string; count: number; avoid?: string[] }

function buildPrompt(requests: GenReq[]): string {
  const lines = requests.map((r) => {
    const avoid = r.avoid && r.avoid.length ? ` Do not use any of these: ${r.avoid.join(', ')}.` : '';
    return `- "${r.categoryId}": ${r.count} word${r.count === 1 ? '' : 's'}.${avoid}`;
  });
  return [
    'You generate tile words for a word-association game.',
    'For every category below, return exactly the requested number of distinct words that clearly and unambiguously belong to that category.',
    'Each word must be a single common English word (occasionally two), Title Case, recognizable, and suitable for a small game tile.',
    'Words must be distinct within a category and must not repeat any word in that category’s exclusion list.',
    '',
    'Categories:',
    ...lines,
  ].join('\n');
}

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
  console.log(`play order: ${order.length} levels · uses category_list[0..${slots - 1}] · ${short.length} short category slots`);

  if (short.length > 0 && GENERATE) {
    const byCat = new Map<string, GenReq>();
    for (const p of short) {
      const count = p.need - p.chosen.length + GEN_BUFFER;
      const prev = byCat.get(p.categoryId);
      if (prev) prev.count = Math.max(prev.count, count);
      else byCat.set(p.categoryId, { categoryId: p.categoryId, count, avoid: wordsFor(p.categoryId) });
    }
    const requests = [...byCat.values()];
    console.log(`\ngenerating words for ${requests.length} categories (${requests.reduce((n, r) => n + r.count, 0)} requested)…`);
    const results = await runClaude(buildPrompt(requests));
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

  // Fill (text-only) in memory.
  const filled = plan.map((l) => {
    const categories = l.skel.categories.map((c) => {
      const pick = l.picks.find((p) => p.letter === c.letter)!;
      return { ...c, pinnedCategoryId: pick.categoryId, pinnedWords: pick.chosen };
    });
    return { file: byId.get(l.id)!.file, level: fillSkeleton({ ...l.skel, categories }, { padGaps: true, textOnly: true }) };
  });

  if (WRITE) {
    for (const f of filled) writeFileSync(join(resolve(levelsDir), f.file), JSON.stringify(f.level, null, 2) + '\n');
    console.log(`\n[written] ${filled.length} level files (text-only, play-order categories; limits/layout/order preserved).`);
  } else {
    console.log(`\n[dry-run] filled ${filled.length} levels in memory. Re-run with --generate --write to apply.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
