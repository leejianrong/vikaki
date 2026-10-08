/** A run of mono audio. Samples are floats in [-1, 1]. */
export interface AudioChunk {
  samples: Float32Array;
  sampleRate: number;
}

export interface SynthesisRequest {
  text: string;
  /** Engine-specific voice id. Unknown ids fall back to the engine's default. */
  voice?: string;
  /** Aborting stops synthesis promptly. The iterator then ends without an error. */
  signal?: AbortSignal;
}

/**
 * A text-to-speech engine, behind one interface so vendors can change (PLAN, swappable parts).
 * `synthesize` yields audio as it is produced, so playback can start before a sentence is finished.
 */
export interface Tts {
  readonly name: string;
  synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk>;
  /** Release whatever the engine holds (a worker thread, a model). Safe to omit for engines that hold nothing. */
  close?(): Promise<void>;
}

/** Thrown by an engine when it cannot produce audio. The hub reports it to the driver as `tts_failed`. */
export class TtsError extends Error {
  readonly code = "tts_failed";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TtsError";
  }
}
