// The lip-sync scorecard: how well a mouth followed a line of speech (VIK-49, docs/observability.md). Pure maths over two things that were
// recorded, the audio and the mouth's openness over time, so it runs the same in a test, a script or the page. The mouth comes from the
// timeline recorder's frames; `opennessOf` turns the five commanded mouth shapes into one number.

/** The mouth over time: `open[i]` (0 closed, 1 wide) at `t[i]` seconds from the start of the audio. Frames may be any rate, but in order. */
export interface MouthTrack {
  t: ArrayLike<number>;
  open: ArrayLike<number>;
}

export interface LineScore {
  seconds: number;
  /** Correlation (-1 to 1) of the mouth with the loudness at no lag. 0 for a mouth that never moves. Higher is better. */
  loudnessMatch: number;
  /** How far the mouth runs behind the sound, in ms (negative: ahead of it), where the match is best. Near 0, a little behind, is natural. */
  lagMs: number;
  /** The correlation at that lag. Higher is better. */
  matchAtBestLag: number;
  /** Share of the quiet time (after a grace for the mouth to close) with the mouth shut. 1 is best. `null` if the audio has no quiet time. */
  silenceClosure: number | null;
  /** How far the mouth opens while speech is loud: the 95th minus the 5th percentile of its openness there. Wide is expressive; near 0 is stuck. */
  opennessRange: number;
  /** Mean change of openness from one 1/60 s step to the next. Low is smooth; a mouth that flaps scores high. */
  jitter: number;
}

/** Hop of the loudness envelope, in seconds. */
const HOP = 0.01;
/** Loudness below this share of the line's loud level counts as quiet (about -34 dB). */
const QUIET = 0.02;
/** Loudness above this share counts as speech, for the openness range. */
const LOUD = 0.25;
/** After speech stops the mouth is given this long to close before it is judged. */
const GRACE = 0.2;
/** Openness below this is a closed mouth. */
const CLOSED = 0.1;
/** The lags tried, either side of zero, in seconds. */
const MAX_LAG = 0.3;

/** The five mouth shapes (`aa ih ou ee oh`) added into one openness, stopping at 1. */
export function opennessOf(weights: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < weights.length; i++) s += weights[i]!;
  return Math.min(1, Math.max(0, s));
}

/** RMS loudness every `HOP`, scaled so the 95th percentile of the line is 1 (and clipped there). */
function envelope(samples: Float32Array, rate: number): Float64Array {
  const size = Math.max(1, Math.round(HOP * rate));
  const n = Math.floor(samples.length / size);
  const rms = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = k * size; i < (k + 1) * size; i++) sum += samples[i]! * samples[i]!;
    rms[k] = Math.sqrt(sum / size);
  }
  const level = percentile(rms, 0.95);
  if (!(level > 1e-4)) throw new Error("the audio has no sound in it");
  return rms.map((v) => Math.min(1, v / level));
}

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const at = p * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** The mouth's openness at time `t`, by straight lines between frames, and the first or last frame's value outside them. */
function sampleAt(m: MouthTrack, t: number, hint: { i: number }): number {
  const n = m.t.length;
  if (t <= m.t[0]!) return m.open[0]!;
  if (t >= m.t[n - 1]!) return m.open[n - 1]!;
  while (hint.i + 1 < n && m.t[hint.i + 1]! <= t) hint.i++;
  while (hint.i > 0 && m.t[hint.i]! > t) hint.i--;
  const t0 = m.t[hint.i]!;
  const t1 = m.t[hint.i + 1]!;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return m.open[hint.i]! + (m.open[hint.i + 1]! - m.open[hint.i]!) * f;
}

/** The mouth on a regular grid: bin `k` at `(k + offset) * step + ahead` seconds, so a positive `ahead` reads the mouth later than the bin. */
function resample(m: MouthTrack, count: number, step: number, offset: number, ahead: number): Float64Array {
  const out = new Float64Array(count);
  const hint = { i: 0 };
  for (let k = 0; k < count; k++) out[k] = sampleAt(m, (k + offset) * step + ahead, hint);
  return out;
}

/** Pearson correlation; 0 when either side does not vary, because "no movement" is not a match. */
function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa < 1e-9 || sbb < 1e-9 ? 0 : sab / Math.sqrt(saa * sbb);
}

/** Score one line: the audio that was spoken (`rate` Hz) against the mouth that was shown for it. */
export function scoreLine(samples: Float32Array, rate: number, mouth: MouthTrack): LineScore {
  if (mouth.t.length === 0 || mouth.t.length !== mouth.open.length) throw new Error("no mouth frames to score");
  const loud = envelope(samples, rate);
  const n = loud.length;
  const seconds = samples.length / rate;

  // The match, at every lag from -MAX_LAG to +MAX_LAG: the loudness at each moment against the mouth `lag` later (a mouth behind the sound).
  const steps = Math.round(MAX_LAG / HOP);
  let best = { lag: 0, r: -Infinity };
  let atZero = 0;
  for (let s = -steps; s <= steps; s++) {
    const r = correlation(loud, resample(mouth, n, HOP, 0.5, s * HOP));
    if (s === 0) atZero = r;
    if (r > best.r + 1e-9) best = { lag: s, r };
  }
  const open = resample(mouth, n, HOP, 0.5, 0);

  // The quiet: bins below the quiet level, once the mouth has had its grace to close after speech.
  let quiet = 0;
  let closed = 0;
  let lastLoud = -Infinity;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) * HOP;
    if (loud[k]! >= QUIET) lastLoud = t;
    else if (t - lastLoud >= GRACE) {
      quiet++;
      if (open[k]! < CLOSED) closed++;
    }
  }

  const speech: number[] = [];
  for (let k = 0; k < n; k++) if (loud[k]! >= LOUD) speech.push(open[k]!);

  // The flutter, over the whole line at the 60 Hz a page draws at.
  const frames = Math.max(2, Math.floor(seconds * 60));
  const steady = resample(mouth, frames, 1 / 60, 0, 0); // on the frame instants, not between them, so a flapping mouth is seen to flap
  let moved = 0;
  for (let i = 1; i < frames; i++) moved += Math.abs(steady[i]! - steady[i - 1]!);

  return {
    seconds,
    loudnessMatch: atZero,
    lagMs: best.lag * HOP * 1000,
    matchAtBestLag: best.r,
    silenceClosure: quiet === 0 ? null : closed / quiet,
    opennessRange: speech.length === 0 ? 0 : percentile(speech, 0.95) - percentile(speech, 0.05),
    jitter: moved / (frames - 1),
  };
}

/** The mouth's five shapes (`aa ih ou ee oh`, in that order) at each frame, `t` in seconds from the start of the audio. */
export interface ShapeTrack {
  t: ArrayLike<number>;
  shapes: ArrayLike<number>[];
}

/**
 * How often the mouth made the shape of the vowel being spoken (VIK-51). For each vowel in `spans` (the phoneme track: `t` and `d` in ms) that
 * lasts at least `minMs`, the shapes are averaged over the middle of it; the vowel is a hit when the strongest shape is the one `expected` names
 * for it, and a miss when another is strongest or the mouth is all but shut. `expected` returns the index of a vowel's shape, or undefined for a
 * sound that is not a vowel. The spans come from an estimate, so this is agreement with the phoneme track, not with the truth.
 */
export function vowelMatch(mouth: ShapeTrack, spans: { p: string; t: number; d: number }[], expected: (p: string) => number | undefined, minMs = 60): { hits: number; vowels: number } {
  let hits = 0;
  let vowels = 0;
  for (const s of spans) {
    const want = expected(s.p);
    if (want === undefined || s.d < minMs) continue;
    const from = (s.t + 0.2 * s.d) / 1000;
    const to = (s.t + 0.8 * s.d) / 1000;
    const sum = [0, 0, 0, 0, 0];
    let n = 0;
    for (let i = 0; i < mouth.t.length; i++) {
      if (mouth.t[i]! < from || mouth.t[i]! > to) continue;
      for (let k = 0; k < 5; k++) sum[k]! += mouth.shapes[i]![k] ?? 0;
      n++;
    }
    if (n === 0) continue;
    vowels++;
    const mean = sum.map((v) => v / n);
    const top = mean.indexOf(Math.max(...mean));
    if (mean[top]! >= 0.08 && top === want) hits++;
  }
  return { hits, vowels };
}
