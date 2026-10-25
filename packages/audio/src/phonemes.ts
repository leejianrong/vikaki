// Phonemes with times (VIK-50, ADR-0047). The speech model outputs a waveform and nothing else, so when the engine can say which
// phonemes it spoke (as an IPA string), their times are worked out from the audio: each word gets time in proportion to how long its
// sounds usually take, its edges are pulled to the nearest dip in loudness (`estimateWordTimings`), and the sounds are spread through it.
// Pure, so the server and a test run the same code.
import { estimateWordTimings } from "./words.ts";

/** One phoneme and when it is spoken: milliseconds from the start of the audio it was aligned to. `s` is stress: 1 primary, 2 secondary. */
export interface PhonemeSpan {
  p: string;
  t: number;
  d: number;
  s?: 1 | 2;
}

const VOWELS = new Set([..."aeiouyæɑɒɔəɚɛɜɝɪʊʌɐɨɵøœɯɤɘɞɶʉɤ"]);
const STOPS = new Set([..."pbtdkgʔcɟqɢ"]);
const FRICATIVES = new Set([..."fvszʃʒθðhxçɣχʁɕʑɸβ"]);
/** Marks that belong to the sound before them. */
const MODIFIERS = new Set([..."ːˑʰʲʷˠˤ̩̯̥̃̊͡ʼ"]);
const PAUSES = new Set([..."|,.;:!?…—–"]);

interface Token {
  p: string;
  stress: 0 | 1 | 2;
  weight: number;
}

/** How long a sound tends to take, relative to a short vowel at 1. A guide to proportions, not a measurement. */
function weightOf(symbol: string, stress: number): number {
  const base = [...symbol][0]!;
  const long = /[ːˑ]/.test(symbol) ? 1.6 : 1;
  if (VOWELS.has(base)) return (base === "ə" || base === "ɐ" ? 0.6 : 1) * long * (stress === 1 ? 1.3 : 1);
  if (STOPS.has(base)) return 0.5;
  if (FRICATIVES.has(base)) return 0.8 * long;
  return 0.65 * long; // nasals, liquids and glides
}

/** Split one word of IPA into sounds: stress marks apply to the next sound, length and similar marks stick to the one before. */
export function tokenizeIpa(word: string): Token[] {
  const out: Token[] = [];
  let stress: 0 | 1 | 2 = 0;
  for (const ch of word) {
    if (ch === "ˈ") stress = 1;
    else if (ch === "ˌ") stress = 2;
    else if (MODIFIERS.has(ch) && out.length > 0) out[out.length - 1]!.p += ch;
    else if (/\s/.test(ch) || PAUSES.has(ch)) continue;
    else {
      out.push({ p: ch, stress, weight: 0 });
      stress = 0;
    }
  }
  for (const t of out) t.weight = weightOf(t.p, t.stress);
  return out;
}

/**
 * When each phoneme of `ipa` is spoken in `samples`. `ipa` is what the engine said for exactly this audio: words separated by spaces,
 * punctuation (or `|`) where there is a pause. Spans are in order, never overlap, and stay inside the stretch where there is sound.
 * An empty string or silent audio gives none. Not an alignment against a model: see ADR-0047 for what that costs.
 */
export function alignPhonemes(ipa: string, samples: Float32Array, rate: number): PhonemeSpan[] {
  const words = ipa.split(/\s+/).filter((w) => tokenizeIpa(w).length > 0 || PAUSES.has(w));
  const tokens = words.map(tokenizeIpa);
  const usable = words.map((w, i) => ({ w, t: tokens[i]! })).filter((x) => x.t.length > 0);
  if (usable.length === 0 || samples.length === 0) return [];
  const weights = usable.map((x) => x.t.reduce((a, t) => a + t.weight, 0));
  const timings = estimateWordTimings(usable.map((x) => x.w).join(" "), samples, rate, { weights });
  const out: PhonemeSpan[] = [];
  let last = 0;
  for (const [i, word] of usable.entries()) {
    const at = timings[i];
    if (!at) break;
    let t = Math.max(at.start, last / 1000);
    const total = weights[i]!;
    const span = Math.max(0, at.end - t);
    for (const tok of word.t) {
      const d = span * (tok.weight / total);
      const start = Math.round(t * 1000);
      const end = Math.max(start + 1, Math.round((t + d) * 1000));
      out.push({ p: tok.p, t: start, d: end - start, ...(tok.stress ? { s: tok.stress } : {}) });
      t += d;
      last = end;
    }
  }
  return out;
}
