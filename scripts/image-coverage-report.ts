// Report how well a folder of levels is covered by the image art set:
// which category slots can be shown as their own pictures, which can't, and the
// gaps (category names used that have no art) — so you can decide whether to
// fill levels from art-backed categories or generate art for the names you use.
//
//   npx tsx scripts/image-coverage-report.ts <levelsDir> [outFile.md]
// Prints a summary; writes the full markdown report to outFile (default
// image-coverage-report.md in the web root).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(__dirname, '..');
const imageCats: { categoryId: string; wordsIds: string[] }[] = JSON.parse(
  readFileSync(join(WEB, 'src/editor/catalog/image_categories.json'), 'utf8'),
);
const ART = new Map(imageCats.map((c) => [c.categoryId, c.wordsIds.length]));
const snake = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: image-coverage-report.ts <levelsDir> [outFile.md]');
  process.exit(1);
}
const root = resolve(dir);
const outFile = resolve(process.argv[3] ?? join(WEB, 'image-coverage-report.md'));
const files = readdirSync(root).filter((f) => f.endsWith('.json')).sort((a, b) => {
  const n = (s: string) => Number(s.replace(/\D/g, '')) || 0;
  return n(a) - n(b) || a.localeCompare(b);
});

type Status = 'image' | 'enough' | 'few' | 'none';
interface Slot { level: string; name: string; snake: string; need: number; art: number; status: Status }
const slots: Slot[] = [];
const usedSnakes = new Set<string>();

for (const f of files) {
  const lvl = JSON.parse(readFileSync(join(root, f), 'utf8'));
  for (const c of lvl.categories) {
    const need = c.wordsData.length;
    const sn = snake(c.categoryId);
    usedSnakes.add(sn);
    const art = ART.get(sn) ?? 0;
    const allIcon = need > 0 && c.wordsData.every((w: { icon?: boolean }) => w.icon);
    const status: Status = allIcon ? 'image' : art === 0 ? 'none' : art >= need ? 'enough' : 'few';
    slots.push({ level: f.replace(/\.json$/, ''), name: c.categoryId, snake: sn, need, art, status });
  }
}

const by = (s: Status) => slots.filter((x) => x.status === s);
const pct = (n: number) => `${((100 * n) / slots.length).toFixed(0)}%`;

// Gaps: distinct category names with NO art, by frequency.
const gap = new Map<string, { name: string; slots: number; levels: Set<string>; maxNeed: number }>();
for (const s of by('none')) {
  const g = gap.get(s.snake) ?? { name: s.name, slots: 0, levels: new Set(), maxNeed: 0 };
  g.slots++; g.levels.add(s.level); g.maxNeed = Math.max(g.maxNeed, s.need);
  gap.set(s.snake, g);
}
// Partial: art exists but too few in at least one slot.
const few = new Map<string, { name: string; art: number; maxNeed: number; levels: Set<string> }>();
for (const s of by('few')) {
  const g = few.get(s.snake) ?? { name: s.name, art: s.art, maxNeed: 0, levels: new Set() };
  g.maxNeed = Math.max(g.maxNeed, s.need); g.levels.add(s.level);
  few.set(s.snake, g);
}
const unusedArt = imageCats
  .filter((c) => !usedSnakes.has(c.categoryId))
  .map((c) => c.categoryId)
  .sort();

const L: string[] = [];
L.push('# Image coverage report');
L.push('');
L.push(`Levels dir: \`${root}\`  ·  ${files.length} levels, ${slots.length} category slots`);
L.push('');
L.push('## Summary');
L.push('');
L.push(`| status | slots | share |`);
L.push(`| --- | ---: | ---: |`);
L.push(`| ✓ own art, enough pictures | ${by('enough').length} | ${pct(by('enough').length)} |`);
L.push(`| 🖼 already images | ${by('image').length} | ${pct(by('image').length)} |`);
L.push(`| ⚠ own art but too few | ${by('few').length} | ${pct(by('few').length)} |`);
L.push(`| ✗ no art for this category | ${by('none').length} | ${pct(by('none').length)} |`);
L.push('');
L.push(`Distinct category names used: **${usedSnakes.size}** · art set has **${imageCats.length}** categories · **${unusedArt.length}** art categories unused by any level.`);
L.push('');

L.push('## Gaps — category names used but with NO art');
L.push('');
L.push('These need art generated (or replace the category with an art-backed one). Sorted by how many slots use them.');
L.push('');
L.push('| category | slots | levels | max words needed |');
L.push('| --- | ---: | ---: | ---: |');
for (const g of [...gap.values()].sort((a, b) => b.slots - a.slots || a.name.localeCompare(b.name))) {
  L.push(`| ${g.name} | ${g.slots} | ${g.levels.size} | ${g.maxNeed} |`);
}
L.push('');

L.push('## Partial — art exists but too few pictures');
L.push('');
L.push('Close: generate a few more pictures for these, or reduce the slot\'s card count.');
L.push('');
L.push('| category | art pictures | max needed | levels |');
L.push('| --- | ---: | ---: | --- |');
for (const g of [...few.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  L.push(`| ${g.name} | ${g.art} | ${g.maxNeed} | ${[...g.levels].join(', ')} |`);
}
L.push('');

L.push('## Per level');
L.push('');
for (const f of files) {
  const ls = slots.filter((s) => s.level === f.replace(/\.json$/, ''));
  const tag = (st: Status) => ls.filter((s) => s.status === st).map((s) => s.name);
  const enough = [...tag('enough'), ...tag('image')];
  const head = `**${f.replace(/\.json$/, '')}** — ${enough.length}/${ls.length} imageable`;
  const parts: string[] = [];
  if (enough.length) parts.push(`✓ ${enough.join(', ')}`);
  if (tag('few').length) parts.push(`⚠ ${tag('few').map((n) => n).join(', ')}`);
  if (tag('none').length) parts.push(`✗ ${tag('none').join(', ')}`);
  L.push(`- ${head} — ${parts.join('  ·  ')}`);
}
L.push('');

L.push('## Unused art categories (available to fill levels with)');
L.push('');
L.push(unusedArt.join(', '));
L.push('');

writeFileSync(outFile, L.join('\n'));

// Console summary
console.log(`${files.length} levels, ${slots.length} category slots`);
console.log(`  ✓ own art, enough : ${by('enough').length} (${pct(by('enough').length)})`);
console.log(`  🖼 already images  : ${by('image').length}`);
console.log(`  ⚠ art but too few : ${by('few').length}`);
console.log(`  ✗ no art          : ${by('none').length} (${pct(by('none').length)})`);
console.log(`distinct names used: ${usedSnakes.size} | art categories: ${imageCats.length} | unused art: ${unusedArt.length}`);
console.log(`\ntop gaps (no art): ${[...gap.values()].sort((a, b) => b.slots - a.slots).slice(0, 15).map((g) => `${g.name}(${g.slots})`).join(', ')}`);
console.log(`\nfull report → ${outFile}`);
