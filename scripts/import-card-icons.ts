// Import a fresh card-icon art set into the web image catalog (FULL REPLACE).
//
// The source set is organized as <anything>/<CATEGORY>-<NN>.png — a category
// name plus a per-picture index, with NO word identity. Category names recur
// across many source folders (mostly identical pictures, occasionally not), so
// we MERGE by normalized categoryId and DEDUP identical pictures by content
// hash. Word tokens are synthesized as zero-padded indices ("01", "02", …) —
// never shown to players (an icon tile renders only the picture, CardView.tsx),
// so they are pure catalog bookkeeping.
//
//   npx tsx scripts/import-card-icons.ts <srcDir> [--write]
//     --write   wipe public/images, copy the renamed PNGs, and rewrite
//               catalog/image_categories.json + catalog/images.ts
//   default: dry-run — prints the category report, writes nothing.
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const IMAGES_DIR = join(WEB_ROOT, 'public', 'images');
const IMAGE_CATS_PATH = join(WEB_ROOT, 'src', 'editor', 'catalog', 'image_categories.json');
const IMAGES_TS_PATH = join(WEB_ROOT, 'src', 'editor', 'catalog', 'images.ts');

// Same normalization fill.ts uses, so ids/tokens match the rest of the catalog.
function toSnake(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function walkPngs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkPngs(full));
    else if (name.toLowerCase().endsWith('.png')) out.push(full);
  }
  return out;
}

// "SEA FISH-03.png" -> "SEA FISH"; "PIRATE-01-5.png" -> "PIRATE"; "3D-01.png" -> "3D".
function categoryNameFromFile(file: string): string {
  const base = file.replace(/\.png$/i, '');
  const m = base.match(/^(.+?)-\d+(?:-\d+)?$/);
  const name = m ? m[1] : base;
  return name.replace(/-\d+$/, ''); // safety for odd "X-01" stems
}

interface Pic {
  hash: string;
  srcPath: string;
  sortKey: string; // deterministic order across folders
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const srcDir = args.find((a) => !a.startsWith('--'));
  if (!srcDir) {
    console.error('usage: import-card-icons.ts <srcDir> [--write]');
    process.exit(1);
  }
  const src = resolve(srcDir);

  const files = walkPngs(src).sort();
  // categoryId -> normalized name collisions, and the deduped picture list.
  const rawNames = new Map<string, Set<string>>(); // id -> original display names merged
  const byCat = new Map<string, Pic[]>();
  const seenHashPerCat = new Map<string, Set<string>>();
  let dupSkipped = 0;

  for (const f of files) {
    const fname = f.slice(f.lastIndexOf('/') + 1);
    const dispName = categoryNameFromFile(fname);
    const id = toSnake(dispName);
    if (!id) continue;
    const hash = createHash('md5').update(readFileSync(f)).digest('hex');
    const rel = f.slice(src.length + 1); // "<folder>/<file>"
    if (!rawNames.has(id)) rawNames.set(id, new Set());
    rawNames.get(id)!.add(dispName);
    if (!byCat.has(id)) {
      byCat.set(id, []);
      seenHashPerCat.set(id, new Set());
    }
    const seen = seenHashPerCat.get(id)!;
    if (seen.has(hash)) {
      dupSkipped++;
      continue;
    }
    seen.add(hash);
    byCat.get(id)!.push({ hash, srcPath: f, sortKey: rel });
  }

  // Deterministic token assignment per category.
  const catalog: { categoryId: string; wordsIds: string[] }[] = [];
  const copies: { from: string; to: string }[] = []; // to = "<id>__<token>.png"
  const ids = [...byCat.keys()].sort();
  for (const id of ids) {
    const pics = byCat.get(id)!.slice().sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const width = Math.max(2, String(pics.length).length);
    const tokens: string[] = [];
    pics.forEach((p, i) => {
      const token = String(i + 1).padStart(width, '0');
      tokens.push(token);
      copies.push({ from: p.srcPath, to: `${id}__${token}.png` });
    });
    catalog.push({ categoryId: id, wordsIds: tokens });
  }

  // ---- Report ----
  const counts = catalog.map((c) => c.wordsIds.length).sort((a, b) => a - b);
  const totalImgs = counts.reduce((a, b) => a + b, 0);
  const bucket = (pred: (n: number) => boolean) => counts.filter(pred).length;
  const collisions = [...rawNames.entries()].filter(([, names]) => names.size > 1);

  console.log(`source files scanned : ${files.length}`);
  console.log(`duplicate pics merged : ${dupSkipped}`);
  console.log(`categories            : ${catalog.length}`);
  console.log(`distinct pictures     : ${totalImgs}`);
  console.log(
    `images / category     : min ${counts[0]}  median ${counts[(counts.length / 2) | 0]}  max ${counts[counts.length - 1]}`,
  );
  console.log(
    `coverage              : >=8: ${bucket((n) => n >= 8)}   >=6: ${bucket((n) => n >= 6)}   >=4: ${bucket((n) => n >= 4)}   <4: ${bucket((n) => n < 4)}`,
  );
  if (collisions.length) {
    console.log(`\nname collisions (merged into one id):`);
    for (const [id, names] of collisions) console.log(`  ${id}  <-  ${[...names].join(' | ')}`);
  }

  if (!write) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write to apply.`);
    console.log(`would copy ${copies.length} files into public/images/ (replacing existing).`);
    return;
  }

  // ---- Write (FULL REPLACE) ----
  rmSync(IMAGES_DIR, { recursive: true, force: true });
  mkdirSync(IMAGES_DIR, { recursive: true });
  for (const c of copies) copyFileSync(c.from, join(IMAGES_DIR, c.to));

  writeFileSync(IMAGE_CATS_PATH, JSON.stringify(catalog, null, 2) + '\n');

  const lines = catalog.flatMap((c) => c.wordsIds.map((t) => `  "${c.categoryId}__${t}",`));
  const ts = `// Auto-generated from \`web/public/images/\` by scripts/import-card-icons.ts.
export const AVAILABLE_IMAGES: ReadonlySet<string> = new Set([
${lines.join('\n')}
]);
`;
  writeFileSync(IMAGES_TS_PATH, ts);

  console.log(`\nWROTE ${copies.length} images, ${catalog.length} categories.`);
}

main();
