import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

// Dev-only endpoint that fills word gaps via the local `claude` CLI. It runs
// only inside `vite dev` (configureServer + apply: 'serve'), so it is never
// part of the production build and needs no API key — it reuses the
// developer's local Claude Code auth. The editor's "Generate missing words"
// button calls it.
const WORD_GEN_MODEL = 'claude-haiku-4-5';

interface GenReq {
  categoryId: string;
  count: number;
  avoid?: string[];
}

function buildPrompt(requests: GenReq[]): string {
  const lines = requests.map((r) => {
    const avoid =
      r.avoid && r.avoid.length ? ` Do not use any of these: ${r.avoid.join(', ')}.` : '';
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

const WORD_GEN_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          categoryId: { type: 'string' },
          words: { type: 'array', items: { type: 'string' } },
        },
        required: ['categoryId', 'words'],
        additionalProperties: false,
      },
    },
  },
  required: ['categories'],
  additionalProperties: false,
});

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
          const categories = await runClaude(buildPrompt(requests));
          res.statusCode = 200;
          res.end(JSON.stringify({ results: categories }));
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
  server: { port: 5173, host: true },
});
