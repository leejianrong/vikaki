/** A run of mono audio. Samples are floats in [-1, 1]. */
export interface AudioChunk {
  samples: Float32Array;
  sampleRate: number;
  /**
   * The words this audio says, on a chunk that holds the whole piece of text it is for (VIK-50, ADR-0049). The hub turns it into phonemes with its own
   * dictionary and times them against this audio, so an engine does not have to know any phonemes. An engine that streams a piece in several chunks
   * leaves it out.
   */
  text?: string;
  /** The phonemes as IPA, for an engine that knows its own (the hub then does not guess from `text`). Same rule: only on a chunk with the whole piece. */
  phonemes?: string;
}

export interface SynthesisRequest {
  text: string;
  /** Engine-specific voice id. Unknown ids fall back to the engine's default. */
  voice?: string;
  /** How to say it, in plain words ("a warm, amused whisper"), for engines that take free-text direction (VIK-140). Engines that cannot use it ignore it. */
  style?: string;
  /** The emotion behind `style` ("smug", "worried"), for engines whose control is a number, not words (Chatterbox's exaggeration, VIK-143). Engines that do not use it ignore it. */
  emotion?: string;
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
