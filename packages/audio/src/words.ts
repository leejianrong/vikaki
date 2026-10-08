/** One word and when it is spoken, in seconds from the start of the audio it was estimated from. */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/**
 * Where a better source plugs in: anything that turns the text and its audio into word times. The estimate below
 * is the default, because the speech model outputs only a waveform, with no durations.
 */
export type WordTimer = (text: string, samples: Float32Array, rate: number) => WordTiming[];

const HOP = 0.01; // seconds per energy frame
const ACTIVE_DB = 35; // a frame is speech when within this many dB of the loud end of the clip
const MIN_WORD = 0.03; // no word is shorter than this
/** How much a dip far from where the syllable count says a boundary belongs is discounted, against a dip right there. */
const DISTANCE_PENALTY = 1;
const MIN_GAP_FRAMES = 5; // a quiet stretch this long (50 ms) is a pause between words, not part of either word

/** A rough count of syllables: runs of vowels, a silent final "e" ignored, each CJK character as one. Never less than 1. */
export function syllables(word: string): number {
  const cjk = word.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0;
  const latin = word.replace(/[぀-ヿ㐀-鿿가-힯]/g, " ").toLowerCase();
  let groups = latin.match(/[aeiouyà-ÿ]+/g)?.length ?? 0;
  if (groups > 1 && /[^aeiouyl]e[^a-zà-ÿ]*$/.test(latin)) groups--; // "make", "one": the final e is silent
  const digits = latin.match(/\d+/g)?.length ?? 0;
  return Math.max(1, groups + cjk + digits);
}

/** How long the pause after a word is likely to be, in syllables' worth of time. */
function pauseAfter(word: string): number {
  if (/[.!?…。！？]["'”’)\]]*$/.test(word)) return 0.9;
  if (/[,;:，；：、—–-]["'”’)\]]*$/.test(word)) return 0.5;
  return 0;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/** Root mean square loudness per 10 ms frame over a 20 ms window. */
function energy(samples: Float32Array, rate: number): Float32Array {
  const hop = Math.max(1, Math.round(rate * HOP));
  const win = hop * 2;
  const frames = Math.max(0, Math.floor(samples.length / hop));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sq = 0;
    let n = 0;
    for (let i = f * hop; i < Math.min(samples.length, f * hop + win); i++) {
      sq += samples[i]! * samples[i]!;
      n++;
    }
    out[f] = n ? Math.sqrt(sq / n) : 0;
  }
  return out;
}

/**
 * Estimate when each word of `text` is spoken in `samples`. Not an alignment: words are given time in proportion to
 * their syllables across the stretch where there is sound, and each boundary is then pulled to the nearest dip in loudness
 * (a real gap between words if there is one). Good enough to follow along; replace it through `WordTimer` when a
 * source that knows the real durations is available.
 */
export function estimateWordTimings(text: string, samples: Float32Array, rate: number, options: { distancePenalty?: number } = {}): WordTiming[] {
  const penalty = options.distancePenalty ?? DISTANCE_PENALTY;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const duration = samples.length / rate;
  const e = energy(samples, rate);

  const loud = Math.max(1e-6, percentile(e, 0.95));
  const floor = Math.max(1e-4, loud * 10 ** (-ACTIVE_DB / 20));
  const active = Array.from(e, (v) => v > floor);
  const first = active.indexOf(true);
  const last = active.lastIndexOf(true);
  const need = MIN_WORD * words.length;
  const length = Math.max(duration, need); // a clip too short for its words is stretched so each still gets its minimum
  let spanStart = first < 0 ? 0 : first * HOP;
  let spanEnd = first < 0 ? length : Math.min(duration, (last + 1) * HOP);
  if (spanEnd - spanStart < need) {
    spanStart = 0;
    spanEnd = length;
  }
  const span = spanEnd - spanStart;

  const slots = words.map((w) => syllables(w) + pauseAfter(w));
  const total = slots.reduce((a, b) => a + b, 0);
  const edges: { end: number; gapEnd: number }[] = []; // where each word ends, and where the next begins
  let acc = 0;
  for (let i = 0; i < words.length - 1; i++) {
    acc += slots[i]!;
    let boundary = spanStart + (acc / total) * span;
    let gapEnd = boundary;
    if (first >= 0 && e.length > 0) {
      const slotSeconds = Math.min(slots[i]!, slots[i + 1]!) * (span / total);
      const reach = Math.max(0.02, Math.min(0.15, 0.4 * slotSeconds));
      const lo = Math.max(0, Math.round((boundary - reach) / HOP));
      const hi = Math.min(e.length - 1, Math.round((boundary + reach) / HOP));
      // A real pause (quiet enough to count as silence) inside the search window wins: take the one nearest the
      // expected place, and the whole of its quiet stretch. Failing that, the quietest frame, but a dip far from the
      // expected place must be much quieter than one right there, so a closure inside a word is not mistaken for its end.
      let best = -1;
      let bestScore = Infinity;
      for (let f = lo; f <= hi; f++) {
        const near = Math.abs(f * HOP - boundary) / reach;
        const smooth = ((e[f - 1] ?? e[f]!) + e[f]! + (e[f + 1] ?? e[f]!)) / 3;
        const score = (active[f] ? 1 + smooth / loud : near) + (active[f] ? penalty * near * near : 0);
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
      }
      if (best >= 0) {
        boundary = (best + 0.5) * HOP;
        gapEnd = boundary;
        if (!active[best]) {
          let a = best;
          let b = best;
          while (a - 1 >= 0 && !active[a - 1]) a--; // the whole quiet stretch, not just the part inside the search window
          while (b + 1 < active.length && !active[b + 1]) b++;
          if (b - a + 1 >= MIN_GAP_FRAMES) {
            boundary = Math.max(spanStart, a * HOP);
            gapEnd = Math.min(spanEnd, (b + 1) * HOP);
          }
        }
      }
    }
    edges.push({ end: boundary, gapEnd });
  }

  // keep everything in order, inside the clip, and no word shorter than MIN_WORD
  const out: WordTiming[] = [];
  let start = spanStart;
  for (let i = 0; i < words.length; i++) {
    const room = MIN_WORD * (words.length - 1 - i); // what the words after this one still need
    start = Math.min(start, length - MIN_WORD * (words.length - i));
    const edge = edges[i];
    let end = edge ? edge.end : spanEnd;
    end = Math.min(Math.max(end, start + MIN_WORD), length - room);
    out.push({ word: words[i]!, start, end });
    start = edge ? Math.max(edge.gapEnd, end) : end;
  }
  return out;
}
