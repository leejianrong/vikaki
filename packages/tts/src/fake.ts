import { TtsError, type AudioChunk, type SynthesisRequest, type Tts } from "./types.ts";

export interface FakeTtsOptions {
  sampleRate?: number;
  /** Spoken duration per character. */
  msPerChar?: number;
  /** Length of each yielded chunk. */
  chunkMs?: number;
  /** Wait before the first chunk, to imitate a slow engine. */
  firstChunkDelayMs?: number;
  /** Text matching this throws a TtsError, to test failure handling. */
  failOn?: RegExp | string;
}

const FORMANTS: [number, number][] = [
  [800, 90],
  [1200, 110],
  [2600, 160],
];

/** A deterministic "aah": a buzz at 120 Hz through three resonances, so lip sync has something to follow. */
export function synthVowel(seconds: number, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  let x = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += 120 / sampleRate;
    if (phase >= 1) {
      phase -= 1;
      x[i] = 1;
    }
  }
  for (const [freq, bw] of FORMANTS) {
    const r = Math.exp((-Math.PI * bw) / sampleRate);
    const a1 = 2 * r * Math.cos((2 * Math.PI * freq) / sampleRate);
    const a2 = -r * r;
    const y = new Float32Array(n);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i]! + a1 * y1 + a2 * y2;
      y[i] = v;
      y2 = y1;
      y1 = v;
    }
    x = y;
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const fade = Math.max(1, Math.round(0.03 * sampleRate));
  for (let i = 0; i < n; i++) x[i] = ((x[i]! / (peak || 1)) * 0.3 * Math.min(1, i / fade, (n - i) / fade));
  return x;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Canned, deterministic audio for tests: no model, no network, no GPU. The spoken length is
 * `max(300 ms, text length * msPerChar)`, so tests can predict timing exactly.
 */
export class FakeTts implements Tts {
  readonly name = "fake";
  /** Every request received, in order. */
  readonly requests: string[] = [];
  private readonly o: Required<Omit<FakeTtsOptions, "failOn">> & { failOn?: RegExp | string };

  constructor(options: FakeTtsOptions = {}) {
    this.o = { sampleRate: 16000, msPerChar: 55, chunkMs: 100, firstChunkDelayMs: 0, ...options };
  }

  /** How long `text` will take to speak, in seconds. */
  durationOf(text: string): number {
    return Math.max(0.3, (text.length * this.o.msPerChar) / 1000);
  }

  async *synthesize(request: SynthesisRequest): AsyncGenerator<AudioChunk> {
    this.requests.push(request.text);
    const { failOn } = this.o;
    if (failOn !== undefined && (typeof failOn === "string" ? request.text.includes(failOn) : failOn.test(request.text))) {
      throw new TtsError(`simulated failure for: ${request.text.slice(0, 40)}`);
    }
    await sleep(this.o.firstChunkDelayMs, request.signal);
    const total = synthVowel(this.durationOf(request.text), this.o.sampleRate);
    const step = Math.max(1, Math.round((this.o.chunkMs / 1000) * this.o.sampleRate));
    for (let at = 0; at < total.length; at += step) {
      if (request.signal?.aborted) return;
      yield { samples: total.slice(at, at + step), sampleRate: this.o.sampleRate };
    }
  }
}
