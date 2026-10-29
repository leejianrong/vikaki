/** The CMU Pronouncing Dictionary, kept as one string and searched in place. */
export class Pronunciations {
  /** `text` is lines of `word PHONES`, sorted by code point, as `scripts/make-cmudict.mjs` makes. */
  constructor(text: string);
  readonly size: number;
  /** The phones of `word` (lower case) with their stress digits, such as `["HH","AH0","L","OW1"]`, or undefined if the dictionary lacks it. */
  lookup(word: string): string[] | undefined;
}
/** The dictionary that ships with the package, read once. */
export function loadPronunciations(): Pronunciations;
/** Phones with stress digits to IPA, a stress mark before the stressed vowel. */
export function phonesToIpa(phones: readonly string[]): string;
/** Phones for a lower-case word of letters that no dictionary knows, by its spelling. Never throws. */
export function letterToSound(word: string): string[];
/** The phones of a word (lower case, letters and apostrophes): the dictionary's, or built from known parts, or from the spelling. */
export function pronounce(word: string, dict: Pronunciations): string[];
/** A whole number as words: 105 is "one hundred five". */
export function numberToWords(n: number): string[];
/** The phonemes of `text` as IPA, words separated by spaces and a pause mark left on the word that ends a phrase. Never throws. */
export function ipaFor(text: string, dict?: Pronunciations): string;
