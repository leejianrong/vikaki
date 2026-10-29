import type { AudioChunk, SynthesisRequest } from "./types.ts";

export interface KokoroCoreOptions {
  importFrom?: string;
  model?: string;
  dtype?: string;
  voice?: string;
  /** Where the model's input comes from: kokoro-js's eSpeak NG path, or our own dictionary phonemes (ADR-0051). */
  g2p?: "espeak" | "own";
}
export function create(options?: KokoroCoreOptions): Promise<{ name: string; voices: string[]; synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk> }>;
