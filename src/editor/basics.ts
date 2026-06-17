export interface BasicCategory {
  letter: string;
  categoryId: string;
  words: string[];
}

function repeat(word: string, n: number): string[] {
  return Array.from({ length: n }, () => word);
}

export const BASIC_FILL: BasicCategory[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .map((letter) => ({
    letter,
    categoryId: letter,
    words: repeat(letter.toLowerCase(), 20),
  }));

// Curated letter → real category mapping for the "Fill words" editor button.
// Edit freely. Each categoryId must exist in catalog/words.json and have at
// least as many words as the level's largest simple count for that letter,
// otherwise fill throws on Save/Play. Letters absent here (e.g. X) are left
// untouched by the button.
export const WORD_FILL: Record<string, string> = {
  A: 'Animals',
  B: 'Zodiac',
  C: 'Colors',
  D: 'Drinks',
  E: 'Emotions',
  F: 'Fruits',
  G: 'Gems',
  H: 'Houses',
  I: 'Insects',
  J: 'Jobs',
  K: 'Kitchen',
  L: 'Lamps',
  M: 'Music',
  N: 'Nations',
  O: 'Oceans',
  P: 'Plants',
  Q: 'Quilts',
  R: 'Rooms',
  S: 'Sports',
  T: 'Tools',
  U: 'Utensils',
  V: 'Vehicles',
  W: 'Weather',
  Y: 'Yoga',
  Z: 'Birds',
};
