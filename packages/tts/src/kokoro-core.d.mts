import type { AudioChunk, SynthesisRequest } from "./types.ts";

export interface KokoroCoreOptions {
  importFrom?: string;
  model?: string;
  dtype?: string;
  voice?: string;
}
export function create(options?: KokoroCoreOptions): Promise<{ name: string; voices: string[]; synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk> }>;
