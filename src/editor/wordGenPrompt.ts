// Shared spec for AI word generation via the local `claude` CLI. Imported by
// BOTH callers — the dev middleware (vite.config.ts, behind the editor's
// "Generate missing" button) and the refill-by-play-order CLI — so the prompt,
// schema and model can never drift apart (an earlier drift is exactly why the
// middleware generated category-adjacent junk like "Anchor"/"Sail" for "Ship").

export const WORD_GEN_MODEL = 'claude-haiku-4-5';

export interface WordGenReq {
  categoryId: string;
  count: number;
  // Words already in the category — the positive sense/type anchors. Treated as
  // the source of truth for what the category means (not the name alone).
  existing?: string[];
  // Words that must not be reused (cross-category words + the existing ones), to
  // keep every cardId unique level-wide.
  avoid?: string[];
}

export const WORD_GEN_SCHEMA = JSON.stringify({
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

export function buildWordGenPrompt(requests: WordGenReq[]): string {
  const lines = requests.map((r) => {
    const have =
      r.existing && r.existing.length
        ? ` Words already in this category: ${r.existing.join(', ')}.`
        : ' (no example words available — infer from the name.)';
    // The existing words are shown above as anchors; only list cross-category
    // exclusions here so the "do not reuse" line stays meaningful.
    const exclusions = (r.avoid ?? []).filter(
      (a) => !(r.existing ?? []).some((e) => e.toLowerCase() === a.toLowerCase()),
    );
    const avoid = exclusions.length ? ` Do not reuse any of these: ${exclusions.join(', ')}.` : '';
    return `- "${r.categoryId}": ${r.count} more word${r.count === 1 ? '' : 's'}.${have}${avoid}`;
  });
  return [
    'You generate tile words for a word-association game.',
    'For every category below, add the requested number of NEW words that are themselves members of that category.',
    'Each category lists the words already in it. Treat those existing words as the source of truth for what the category means — not the name alone:',
    '  - They fix the sense when the name has more than one meaning (e.g. "Palm" the wrist vs. the tree, "Loader" the worker vs. the digger). Match the SAME sense the existing words establish.',
    '  - They fix the type and specificity. Every new word must be the SAME KIND of thing as the existing words — a co-member of the set, not an adjective, description, or loosely related concept.',
    'CRUCIAL — membership, not association: each new word must itself BE a member/type of the category, never a part, accessory, tool, action, place, or property associated with it. For "Ship" with members like Frigate, Galleon, Tugboat, the words "Anchor" and "Sail" are WRONG (those are parts of a ship, not ships); "Schooner", "Corvette", "Sloop" are right.',
    'Never return a synonym or alternate spelling of a word already present (e.g. if "Autumn" is listed do not add "Fall"; if "Sight" is listed do not add "Vision"; if "Hearing" is listed do not add "Sound").',
    'If the category is a small closed set whose real members are exhausted (the four seasons, the five/six senses, the cardinal directions, etc.), extend only with the most specifically and consistently associated terms of a single kind — never synonyms of the members already listed.',
    'Each word must be a single common English word (occasionally two), Title Case, recognizable, and suitable for a small game tile.',
    'Return exactly the requested count of distinct new words per category, none repeating its existing or excluded words.',
    '',
    'Categories:',
    ...lines,
  ].join('\n');
}
