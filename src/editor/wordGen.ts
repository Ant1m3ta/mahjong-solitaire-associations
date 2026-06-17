// Client side of the dev-only word generator. Talks to the Vite middleware in
// vite.config.ts (which shells out to the local `claude` CLI) and caches
// results in localStorage so the same category is never regenerated.

const CACHE_KEY = 'editor.generatedWords.v1';

export interface GenRequest {
  categoryId: string;
  count: number;
  avoid?: string[];
}

type Cache = Record<string, string[]>;

function loadCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // best-effort
  }
}

export function cachedWordsFor(categoryId: string): string[] {
  return loadCache()[categoryId] ?? [];
}

function mergeIntoCache(categoryId: string, words: string[]): void {
  const cache = loadCache();
  const seen = new Set((cache[categoryId] ?? []).map((w) => w.toLowerCase()));
  const merged = (cache[categoryId] ?? []).slice();
  for (const w of words) {
    if (!seen.has(w.toLowerCase())) {
      seen.add(w.toLowerCase());
      merged.push(w);
    }
  }
  cache[categoryId] = merged;
  saveCache(cache);
}

// Whether the live generator is reachable. The endpoint only exists under
// `vite dev`; in a production build it is absent, so the button is hidden.
export const wordGenAvailable = import.meta.env.DEV;

export async function generateWords(requests: GenRequest[]): Promise<Cache> {
  if (requests.length === 0) return {};
  const res = await fetch('/__editor/generate-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ? String(data.error) : `generate failed (${res.status})`);
  }
  const out: Cache = {};
  for (const r of data.results ?? []) {
    if (r && typeof r.categoryId === 'string' && Array.isArray(r.words)) {
      const words = r.words.filter((w: unknown): w is string => typeof w === 'string');
      mergeIntoCache(r.categoryId, words);
      out[r.categoryId] = words;
    }
  }
  return out;
}
