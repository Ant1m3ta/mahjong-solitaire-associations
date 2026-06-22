import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import {
  buildWordGenPrompt,
  WORD_GEN_MODEL,
  WORD_GEN_SCHEMA,
  type WordGenReq,
} from './src/editor/wordGenPrompt';

const WORDS_PATH = fileURLToPath(new URL('./src/editor/catalog/words.json', import.meta.url));

// Dev-only endpoint that fills word gaps via the local `claude` CLI. It runs
// only inside `vite dev` (configureServer + apply: 'serve'), so it is never
// part of the production build and needs no API key — it reuses the
// developer's local Claude Code auth. The editor's "Generate missing words"
// button calls it. Prompt/schema/model are shared with the refill CLI via
// src/editor/wordGenPrompt.ts.
type GenReq = WordGenReq;

function runClaude(prompt: string): Promise<{ categoryId: string; words: string[] }[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      ['-p', prompt, '--model', WORD_GEN_MODEL, '--output-format', 'json', '--json-schema', WORD_GEN_SCHEMA],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error(`claude CLI failed: ${err.message}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const structured = parsed.structured_output;
          if (!structured || !Array.isArray(structured.categories)) {
            reject(new Error('claude returned no structured_output.categories'));
            return;
          }
          resolve(structured.categories);
        } catch (e) {
          reject(new Error(`could not parse claude output: ${String(e)}`));
        }
      },
    );
  });
}

interface WordsCatalogEntry {
  categoryId: string;
  wordsIds: string[];
}

// Merge generated words into catalog/words.json so the lookup library grows
// permanently. Existing categories get new (case-insensitively unique) words
// appended; unknown categories are added. Returns how many words were added.
function persistToCatalog(results: { categoryId: string; words: string[] }[]): number {
  const catalog = JSON.parse(readFileSync(WORDS_PATH, 'utf8')) as WordsCatalogEntry[];
  const byId = new Map(catalog.map((c) => [c.categoryId, c]));
  let added = 0;
  for (const { categoryId, words } of results) {
    let entry = byId.get(categoryId);
    if (!entry) {
      entry = { categoryId, wordsIds: [] };
      byId.set(categoryId, entry);
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function wordGenPlugin(): Plugin {
  return {
    name: 'editor-word-gen',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/generate-words', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        res.setHeader('Content-Type', 'application/json');
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const requests: GenReq[] = Array.isArray(body.requests) ? body.requests : [];
          if (requests.length === 0) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'no requests' }));
            return;
          }
          const categories = await runClaude(buildWordGenPrompt(requests));
          let persisted = 0;
          try {
            persisted = persistToCatalog(categories);
          } catch (e) {
            server.config.logger.warn(`word-gen: failed to persist to words.json: ${String(e)}`);
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ results: categories, persisted }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/mahjong-solitaire-associations/',
  plugins: [react(), wordGenPlugin()],
  server: {
    port: 5173,
    host: true,
    // The word generator writes words.json mid-session; don't trigger a reload.
    watch: { ignored: [WORDS_PATH] },
  },
});
