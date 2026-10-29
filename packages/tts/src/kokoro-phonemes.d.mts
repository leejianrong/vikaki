import type { Pronunciations } from "./g2p.mjs";
/** Kokoro's phoneme symbols for one word's CMU phones (stress digits on the vowels), such as `["HH","AH0","L","OW1"]` for "həlˈO". */
export function kokoroPhonesFor(phones: readonly string[]): string;
/** The input Kokoro-82M's tokenizer takes for `text`: its own symbols, words apart, `; : , . ! ? — …` kept. Never throws. */
export function kokoroPhonemes(text: string, dict?: Pronunciations): string;
