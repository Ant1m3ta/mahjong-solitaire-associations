// Replace words with pictures across a folder of level files, but ONLY where a
// category has its OWN image set (matched by normalized name) with enough
// pictures — never a random/different theme. Mirrors the Images tool's "Use own
// (all)" applied to every level, written in place.
//
//   npx tsx scripts/apply-own-images.ts <levelsDir> [--write]
//     --write   rewrite changed level files (default: dry-run report only)
//
// Image cards get a namespaced id `<categoryId>__<NN>` (an index, never the
// word), so the same word in two categories never collides. Touches only
// *.json (not *.json.meta) and re-serializes as 2-space JSON, no trailing
// newline, to match the existing files.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(__dirname, '..');
const imageCats: { categoryId: string; wordsIds: string[] }[] = JSON.parse(
  readFileSync(join(WEB, 'src/editor/catalog/image_categories.json'), 'utf8'),
);
const AVAILABLE: Set<string> = new Set(
  imageCats.flatMap((c) => c.wordsIds.map((t) => `${c.categoryId}__${t}`)),
);
const BY_ID = new Map(imageCats.map((c) => [c.categoryId, c]));

const snake = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const imageIdFor = (cat: string, token: string) => `${cat}__${token}`;

interface WordData { wordId: string; icon?: boolean; imageId?: string }
interface Category { categoryId: string; wordsData: WordData[] }
interface BoardCard { x: number; y: number; z: number; cardId: string }
interface Level { categories: Category[]; board: BoardCard[]; stock: string[] }

interface Swap { letter: number; from: string; to: string }

// Apply own-image swaps to one parsed level. Returns the swaps made (mutates).
function applyToLevel(level: Level): Swap[] {
  const finalIds = new Set<string>(); // category ids after swaps — guard collisions
  // Pre-seed with categories we WON'T swap so a swap can't collide with them.
  const willSwap = new Map<number, { to: string; tokens: string[] }>();

  level.categories.forEach((c, i) => {
    const need = c.wordsData.length;
    if (need === 0) return;
    const allIcon = c.wordsData.every((w) => w.icon);
    const stale = allIcon && c.wordsData.some((w) => !w.imageId || !AVAILABLE.has(w.imageId));
    if (allIcon && !stale) return; // already good pictures — leave it
    const set = BY_ID.get(snake(c.categoryId));
    if (!set || set.wordsIds.length < need) return; // no own theme / too few
    willSwap.set(i, { to: set.categoryId, tokens: set.wordsIds.slice(0, need) });
  });

  // Final id set = swapped ids + untouched ids. Drop swaps that would collide.
  level.categories.forEach((c, i) => {
    if (!willSwap.has(i)) finalIds.add(c.categoryId);
  });
  const swaps: Swap[] = [];
  const catMap = new Map<string, string>();
  const wordMap = new Map<string, string>();
  level.categories.forEach((c, i) => {
    const plan = willSwap.get(i);
    if (!plan) return;
    if (finalIds.has(plan.to)) return; // collision with another category — skip
    finalIds.add(plan.to);
    swaps.push({ letter: i, from: c.categoryId, to: plan.to });
    catMap.set(c.categoryId, plan.to);
    c.wordsData.forEach((w, k) => {
      if (k < plan.tokens.length) wordMap.set(w.wordId, imageIdFor(plan.to, plan.tokens[k]));
    });
    c.categoryId = plan.to;
    c.wordsData = plan.tokens.map((t) => ({
      wordId: imageIdFor(plan.to, t),
      icon: true,
      imageId: imageIdFor(plan.to, t),
    }));
  });

  if (swaps.length === 0) return swaps;
  const remap = (id: string) => catMap.get(id) ?? wordMap.get(id) ?? id;
  for (const b of level.board) b.cardId = remap(b.cardId);
  level.stock = level.stock.map(remap);
  return swaps;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: apply-own-images.ts <levelsDir> [--write]');
    process.exit(1);
  }
  const root = resolve(dir);
  const files = readdirSync(root).filter((f) => f.endsWith('.json')).sort();

  let levelsChanged = 0;
  let totalSwaps = 0;
  for (const f of files) {
    const path = join(root, f);
    const level: Level = JSON.parse(readFileSync(path, 'utf8'));
    const swaps = applyToLevel(level);
    if (swaps.length === 0) continue;
    levelsChanged++;
    totalSwaps += swaps.length;
    const desc = swaps.map((s) => (s.from === s.to ? s.to : `${s.from}→${s.to}`)).join(', ');
    console.log(`${f}: ${swaps.length} → ${desc}`);
    if (write) writeFileSync(path, JSON.stringify(level, null, 2));
  }
  console.log(
    `\n${write ? 'WROTE' : 'DRY RUN'}: ${totalSwaps} categories imaged across ${levelsChanged}/${files.length} levels.`,
  );
  if (!write) console.log('Re-run with --write to apply.');
}

main();
