import type { TimelineRecorder } from "./timeline.ts";

export interface MicTimelineOptions {
  /** RMS above which the room is not quiet. */
  gate?: number;
  /** This much quiet ends a phrase. */
  quietMs?: number;
  /** Sound from just before the phrase was noticed is kept. */
  prerollMs?: number;
  /** A phrase that runs on this long is ended and another begun. */
  maxPhraseSeconds?: number;
  /** Audio kept in all, oldest phrase first out. The recorder keeps audio in memory. */
  budgetSeconds?: number;
}

/** The recorder keeps audio at this rate or lower: the spectrogram stops at 8 kHz, and memory matters. */
const KEEP_RATE = 16000;

interface Chunk {
  startPerfMs: number;
  samples: Float32Array;
  rate: number;
}

/** Average blocks of samples down towards `KEEP_RATE` (a crude low-pass and decimation, enough for a picture). */
function decimate(samples: Float32Array, rate: number): { samples: Float32Array; rate: number } {
  const factor = Math.max(1, Math.round(rate / KEEP_RATE));
  if (factor === 1) return { samples: samples.slice(), rate };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k]!;
    out[i] = sum / factor;
  }
  return { samples: out, rate: rate / factor };
}

/**
 * Puts the microphone on the timeline. Each read of the analyser gives the last couple of thousand samples, overlapping the
 * read before; the newest part of each (as much as time has passed) is kept, so the audio is contiguous, and a stall in the page
 * leaves a gap rather than invented sound. Sound is cut into phrases by a loudness gate, each recorded as an utterance with audio
 * and no words (the microphone has no text), with `mic:started` and `mic:finished` events for the events lane.
 */
export class MicTimeline {
  private lastPerfMs?: number;
  private count = 0;
  private phrase?: { id: string; startPerfMs: number; lastLoudPerfMs: number };
  private readonly preroll: Chunk[] = [];
  private readonly kept: { id: string; seconds: number }[] = [];
  private readonly gate: number;
  private readonly quietMs: number;
  private readonly prerollMs: number;
  private readonly maxPhraseSeconds: number;
  private readonly budgetSeconds: number;

  constructor(
    private readonly rec: TimelineRecorder,
    o: MicTimelineOptions = {},
  ) {
    this.gate = o.gate ?? 0.02;
    this.quietMs = o.quietMs ?? 500;
    this.prerollMs = o.prerollMs ?? 150;
    this.maxPhraseSeconds = o.maxPhraseSeconds ?? 60;
    this.budgetSeconds = o.budgetSeconds ?? 120;
  }

  /** `window` is the analyser's latest samples (its buffer may be reused by the caller), read at `perfMs` (a `performance.now()` reading). */
  push(window: Float32Array, rate: number, perfMs: number): void {
    const elapsed = this.lastPerfMs === undefined ? Infinity : perfMs - this.lastPerfMs;
    this.lastPerfMs = perfMs;
    const wanted = Math.min(window.length, Math.max(1, Math.round((elapsed / 1000) * rate)));
    const fresh = window.subarray(window.length - wanted);
    let energy = 0;
    for (const v of fresh) energy += v * v;
    const loud = Math.sqrt(energy / fresh.length) >= this.gate;
    const small = decimate(fresh, rate);
    const chunk: Chunk = { startPerfMs: perfMs - (wanted / rate) * 1000, samples: small.samples, rate: small.rate };

    if (!this.phrase) {
      if (!loud) {
        this.preroll.push(chunk);
        let kept = 0;
        for (let i = this.preroll.length - 1; i >= 0; i--) {
          kept += (this.preroll[i]!.samples.length / this.preroll[i]!.rate) * 1000;
          if (kept > this.prerollMs) this.preroll.splice(0, i);
        }
        return;
      }
      this.begin(chunk, perfMs);
      return;
    }
    this.add(chunk);
    if (loud) this.phrase.lastLoudPerfMs = perfMs;
    const seconds = (perfMs - this.phrase.startPerfMs) / 1000;
    if (perfMs - this.phrase.lastLoudPerfMs >= this.quietMs || seconds >= this.maxPhraseSeconds) this.finish();
  }

  private begin(chunk: Chunk, perfMs: number): void {
    const id = `mic-${++this.count}`;
    const first = this.preroll[0] ?? chunk;
    this.phrase = { id, startPerfMs: first.startPerfMs, lastLoudPerfMs: perfMs };
    this.kept.push({ id, seconds: 0 });
    this.rec.event("mic:started", id);
    for (const c of this.preroll.splice(0)) this.add(c);
    this.add(chunk);
  }

  private add(chunk: Chunk): void {
    const p = this.phrase!;
    this.rec.micAudio(p.id, chunk.startPerfMs, chunk.samples, chunk.rate);
    this.kept[this.kept.length - 1]!.seconds += chunk.samples.length / chunk.rate;
    let total = this.kept.reduce((s, k) => s + k.seconds, 0);
    while (total > this.budgetSeconds && this.kept.length > 1) {
      const oldest = this.kept.shift()!;
      this.rec.forget(oldest.id);
      total -= oldest.seconds;
    }
  }

  private finish(): void {
    this.rec.event("mic:finished", this.phrase!.id);
    this.phrase = undefined;
  }
}
