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
    words: repeat(letter.toLowerCase(), 7),
  }));
