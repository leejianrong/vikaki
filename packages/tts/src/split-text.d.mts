/** Split a long sentence into pieces of at most `max` characters (a cut after punctuation may run a quarter past), at the most natural places. See split-text.mjs. */
export function splitLong(text: string, max?: number, min?: number): string[];
/** Seconds of quiet to put after a piece, by how it ends. */
export function gapAfter(piece: string): number;
/** Cut the quiet off the ends of a piece of speech, keeping `margin` seconds. */
export function trimSilence(samples: Float32Array, rate: number, margin?: number, ends?: { leading?: boolean; trailing?: boolean }): Float32Array;
