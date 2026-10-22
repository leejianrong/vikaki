// The TTS bench (VIK-140): say the same lines through an engine and measure what matters for a table that talks: how long until the first sound, how long the
// whole line takes to make against how long it plays, and the audio itself, to be listened to. No engine is called here but the one given; tests use `FakeTts`.
import type { Tts } from "./types.ts";
import { styleFor } from "./emotion-style.ts";

export interface BenchLine {
  /** What the line is, for the report ("a taunt", "a worried thought"). */
  label: string;
  text: string;
  emotion?: string;
  /** A spoken inner monologue: quiet. */
  thought?: boolean;
  voice?: string;
}

export interface BenchResult {
  label: string;
  characters: number;
  /** Milliseconds from asking to the first audio. */
  firstAudioMs: number | undefined;
  /** Milliseconds to make the whole line. */
  totalMs: number;
  /** How long the audio plays. */
  audioSeconds: number;
  /** Seconds of audio made per second of work: above 1 keeps ahead of playing. */
  realtimeFactor: number;
  /** The audio, 16-bit mono, for `toWav`. */
  samples: Float32Array;
  sampleRate: number;
  error?: string;
}

export async function runBench(tts: Tts, lines: BenchLine[], now: () => number = () => performance.now()): Promise<BenchResult[]> {
  const out: BenchResult[] = [];
  for (const line of lines) {
    const start = now();
    let first: number | undefined;
    const parts: Float32Array[] = [];
    let rate = 24000;
    let error: string | undefined;
    try {
      for await (const chunk of tts.synthesize({ text: line.text, ...(line.voice ? { voice: line.voice } : {}), style: styleFor(line.emotion, { thought: line.thought }) })) {
        first ??= now() - start;
        parts.push(chunk.samples);
        rate = chunk.sampleRate;
      }
    } catch (err) {
      error = (err as Error).message;
    }
    const total = now() - start;
    const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) (samples.set(p, at), (at += p.length));
    const seconds = samples.length / rate;
    out.push({ label: line.label, characters: line.text.length, firstAudioMs: first, totalMs: total, audioSeconds: seconds, realtimeFactor: total > 0 ? seconds / (total / 1000) : 0, samples, sampleRate: rate, ...(error ? { error } : {}) });
  }
  return out;
}

/** A 16-bit mono WAV file of `samples`. */
export function toWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return bytes;
}

/** A table of results as Markdown, one row per line, with the means at the foot. */
export function report(engine: string, results: BenchResult[]): string {
  const ok = results.filter((r) => !r.error);
  const mean = (f: (r: BenchResult) => number | undefined) => {
    const xs = ok.map(f).filter((x): x is number => x !== undefined);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  return [
    `### ${engine}`,
    "",
    "| Line | Chars | First audio | Total | Audio | Speed |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => (r.error ? `| ${r.label} | ${r.characters} | failed: ${r.error} | | | |` : `| ${r.label} | ${r.characters} | ${Math.round(r.firstAudioMs ?? 0)} ms | ${Math.round(r.totalMs)} ms | ${r.audioSeconds.toFixed(1)} s | ${r.realtimeFactor.toFixed(1)}x |`)),
    `| **mean** | | ${Math.round(mean((r) => r.firstAudioMs))} ms | ${Math.round(mean((r) => r.totalMs))} ms | ${mean((r) => r.audioSeconds).toFixed(1)} s | ${mean((r) => r.realtimeFactor).toFixed(1)}x |`,
  ].join("\n");
}
