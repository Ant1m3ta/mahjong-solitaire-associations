// Make "short by exactly one picture" categories fit their own art by dropping
// ONE word — but only a word whose cards are entirely in the STOCK (no board
// card), so the board layout is never touched. Removes the word from wordsData
// and every stock entry referencing it. Run apply-own-images.ts afterwards to
// turn the now-fitting categories into pictures.
//
//   npx tsx scripts/drop-one-stock-card.ts <levelsDir> [--write]
// Dry-run by default; re-serializes as 2-space JSON, no trailing newline.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(__dirname, '..');
const ART = new Map<string, number>(
  (JSON.parse(readFileSync(join(WEB, 'src/editor/catalog/image_categories.json'), 'utf8')) as {
    categoryId: string;
    wordsIds: string[];
  }[]).map((c) => [c.categoryId, c.wordsIds.length]),
);
const snake = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

interface WordData { wordId: string; icon?: boolean; imageId?: string }
interface Level {
  categories: { categoryId: string; wordsData: WordData[] }[];
  board: { cardId: string }[];
  stock: string[];
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: drop-one-stock-card.ts <levelsDir> [--write]');
    process.exit(1);
  }
  const root = resolve(dir);
  const files = readdirSync(root).filter((f) => f.endsWith('.json')).sort();

  let dropped = 0;
  let skipped = 0;
  for (const f of files) {
    const path = join(root, f);
    const level: Level = JSON.parse(readFileSync(path, 'utf8'));
    let changed = false;
    for (const c of level.categories) {
      const need = c.wordsData.length;
      const allIcon = need > 0 && c.wordsData.every((w) => w.icon);
      if (allIcon) continue;
      const art = ART.get(snake(c.categoryId)) ?? 0;
      if (art === 0 || art !== need - 1) continue; // only short by exactly one

      const boardCount = new Map<string, number>();
      const stockCount = new Map<string, number>();
      for (const b of level.board) boardCount.set(b.cardId, (boardCount.get(b.cardId) ?? 0) + 1);
      for (const s of level.stock) stockCount.set(s, (stockCount.get(s) ?? 0) + 1);
      const drop = c.wordsData.find(
        (w) => (boardCount.get(w.wordId) ?? 0) === 0 && (stockCount.get(w.wordId) ?? 0) >= 1,
      );
      if (!drop) {
        console.log(`${f}: ${c.categoryId} — short 1 but NO stock-only word (board cards only); skipped`);
        skipped++;
        continue;
      }
      c.wordsData = c.wordsData.filter((w) => w.wordId !== drop.wordId);
      const before = level.stock.length;
      level.stock = level.stock.filter((id) => id !== drop.wordId);
      console.log(
        `${f}: ${c.categoryId} — drop "${drop.wordId}" (removed ${before - level.stock.length} stock card) → ${c.wordsData.length} words = own art`,
      );
      dropped++;
      changed = true;
    }
    if (changed && write) writeFileSync(path, JSON.stringify(level, null, 2));
  }
  console.log(`\n${write ? 'WROTE' : 'DRY RUN'}: dropped ${dropped} word(s); ${skipped} category(ies) not droppable.`);
  if (!write) console.log('Re-run with --write, then apply-own-images.ts --write.');
}

main();
