/**
 * Prosody: the rise and fall of a voice, and its pauses, as cues a face can answer with a nod or a lifted head.
 * Pure code on sample windows (no Web Audio), so the page and the tests share it.
 */

export type ProsodyCue = "emphasis" | "rise" | "pause";

export interface ProsodyEvent {
  cue: ProsodyCue;
  /** Seconds, on the clock the caller passed to `push`. */
  t: number;
}

export interface Pitch {
  voiced: boolean;
  /** Fundamental frequency in Hz; 0 when not voiced. */
  hz: number;
  /** 0 to 1: how periodic the window is. */
  clarity: number;
  rms: number;
}

const MIN_HZ = 75;
const MAX_HZ = 400;
/** Windows are reduced to about this rate before the search: pitch needs far less than audio bandwidth. */
const WORKING_RATE = 16000;
const VOICED_CLARITY = 0.7;
const SOUND_RMS = 0.02;

/** Pitch of one window by normalised autocorrelation (McLeod's method), with the lag refined to a fraction of a sample. */
export function detectPitch(samples: Float32Array, sampleRate: number): Pitch {
  const factor = Math.max(1, Math.round(sampleRate / WORKING_RATE));
  const n = Math.floor(samples.length / factor);
  const x = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k]!;
    x[i] = sum / factor;
    mean += x[i]!;
  }
  mean /= n || 1;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = x[i]! - mean;
    energy += x[i]! * x[i]!;
  }
  const rms = Math.sqrt(energy / (n || 1));
  const rate = sampleRate / factor;
  const minLag = Math.max(2, Math.floor(rate / MAX_HZ));
  const maxLag = Math.min(n - 2, Math.ceil(rate / MIN_HZ));
  if (rms < SOUND_RMS || maxLag <= minLag) return { voiced: false, hz: 0, clarity: 0, rms };

  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1 && lag < n; lag++) {
    let acf = 0;
    let norm = 0;
    for (let i = 0; i + lag < n; i++) {
      acf += x[i]! * x[i + lag]!;
      norm += x[i]! * x[i]! + x[i + lag]! * x[i + lag]!;
    }
    nsdf[lag] = norm > 0 ? (2 * acf) / norm : 0;
  }
  // The first clear peak after the curve has dipped below zero, not the highest one (which may be a multiple of the period).
  const peaks: number[] = [];
  let seenNegative = false;
  for (let lag = 1; lag <= maxLag; lag++) {
    if (nsdf[lag]! < 0) seenNegative = true; // the dip comes before the first period, so look for it from lag 1
    if (lag >= minLag && seenNegative && nsdf[lag]! > nsdf[lag - 1]! && nsdf[lag]! >= nsdf[lag + 1]! && nsdf[lag]! > 0) peaks.push(lag);
  }
  if (peaks.length === 0) return { voiced: false, hz: 0, clarity: 0, rms };
  const best = Math.max(...peaks.map((l) => nsdf[l]!));
  const lag = peaks.find((l) => nsdf[l]! >= 0.9 * best)!;
  const a = nsdf[lag - 1]!;
  const b = nsdf[lag]!;
  const c = nsdf[lag + 1]!;
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  const clarity = Math.min(1, Math.max(0, b));
  const hz = rate / (lag + shift);
  return clarity >= VOICED_CLARITY && hz >= MIN_HZ && hz <= MAX_HZ ? { voiced: true, hz, clarity, rms } : { voiced: false, hz: 0, clarity, rms };
}

const semitones = (hz: number) => 12 * Math.log2(hz / 100);
const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] ?? 0;

/** A voiced burst this many times louder than the phrase's usual level is a stress. */
const EMPHASIS_RATIO = 1.6;
/** Stresses closer together than this count as one. */
const EMPHASIS_COOLDOWN = 0.5;
/** A phrase must have run this long before a stress or a pause means anything. */
const MIN_PHRASE = 0.5;
/** After this much quiet, check whether the phrase ended on a rise. */
const ENDING_GAP = 0.15;
/** After this much quiet, the speaker has paused. */
const PAUSE_GAP = 0.5;
/** The last third of a phrase's pitch must be this many semitones above its first third for a question-like rise. */
const RISE_SEMITONES = 2;

/** Watches a stream of windows and says when the voice stresses a word, ends a phrase on a rise, or pauses. */
export class ProsodyTracker {
  private inPhrase = false;
  private phraseStart = 0;
  private lastSound = 0;
  private loudness = 0;
  private lastEmphasis = -Infinity;
  private endingChecked = false;
  private voiced: { t: number; st: number }[] = [];

  /** `samples` is the latest window (the last ~40 ms or more) ending at time `t` seconds. Returns the cues this window completes. */
  push(samples: Float32Array, sampleRate: number, t: number): ProsodyEvent[] {
    const events: ProsodyEvent[] = [];
    const p = detectPitch(samples, sampleRate);
    if (p.rms >= SOUND_RMS) {
      if (!this.inPhrase) {
        this.inPhrase = true;
        this.phraseStart = t;
        this.loudness = 0;
        this.voiced = [];
      }
      this.lastSound = t;
      this.endingChecked = false;
      if (p.voiced) {
        this.voiced.push({ t, st: semitones(p.hz) });
        const keep = t - 2;
        while (this.voiced.length > 0 && this.voiced[0]!.t < keep) this.voiced.shift();
        const settled = t - this.phraseStart >= MIN_PHRASE && this.loudness > 0;
        if (settled && p.rms > EMPHASIS_RATIO * this.loudness && t - this.lastEmphasis >= EMPHASIS_COOLDOWN) {
          this.lastEmphasis = t;
          events.push({ cue: "emphasis", t });
        }
        this.loudness = this.loudness === 0 ? p.rms : this.loudness * 0.95 + p.rms * 0.05;
      }
      return events;
    }
    if (!this.inPhrase) return events;
    const quiet = t - this.lastSound;
    const phraseLength = this.lastSound - this.phraseStart;
    if (quiet >= ENDING_GAP && !this.endingChecked) {
      this.endingChecked = true;
      if (phraseLength >= MIN_PHRASE + 0.1 && this.endedOnRise()) events.push({ cue: "rise", t });
    }
    if (quiet >= PAUSE_GAP) {
      if (phraseLength >= MIN_PHRASE) events.push({ cue: "pause", t });
      this.inPhrase = false; // the phrase is over: one pause per phrase, and the next sound starts a new one
    }
    return events;
  }

  private endedOnRise(): boolean {
    const tail = this.voiced.filter((v) => v.t > this.lastSound - 0.6);
    if (tail.length < 6) return false;
    const third = Math.floor(tail.length / 3);
    const start = median(tail.slice(0, third).map((v) => v.st));
    const end = median(tail.slice(-third).map((v) => v.st));
    return end - start >= RISE_SEMITONES;
  }
}
