import { create as createCore } from "./kokoro-core.mjs";
import { TtsError, type AudioChunk, type SynthesisRequest, type Tts } from "./types.ts";
import { WorkerTts } from "./worker-tts.ts";

export interface KokoroOptions {
  /** Hugging Face model id. */
  model?: string;
  /** Weight precision: fp32 (about 330 MB) by default, which was three times faster than q8 (about 90 MB) on the machine it was measured on (VIK-116). `VIKAKI_KOKORO_DTYPE` sets it too. */
  dtype?: "q8" | "q4" | "fp16" | "fp32";
  voice?: string;
  /** Where to import kokoro-js from. Defaults to the package name; tests can pass a file path. */
  importFrom?: string;
  /** Also say which phonemes each piece of speech was (VIK-50): they come from the phonemizer that kokoro-js already installs, so this adds nothing to install. */
  phonemes?: boolean;
  /** Run in this thread instead of a worker. Only for measuring and debugging: it holds the process during synthesis. */
  inProcess?: boolean;
}

/**
 * Local text-to-speech with Kokoro (Apache-2.0 code and model), on CPU. Loaded on demand so that
 * everything else works without its large dependency. About 0.75x real time on a laptop CPU, so a
 * short first sentence takes roughly 1.5 s to produce.
 *
 * It runs in a worker thread: synthesis holds its thread for up to 1.8 s at a time, and in the server's own thread
 * that stalled everything the hub relays (VIK-36). Call `close()` to stop the worker.
 */
export class KokoroTts implements Tts {
  readonly name = "kokoro";
  private constructor(private readonly inner: Tts & { voices: string[] }) {}

  static async create(options: KokoroOptions = {}): Promise<KokoroTts> {
    const { inProcess, ...plain } = options; // what the engine is given must be plain data
    try {
      return new KokoroTts(inProcess ? await createCore(plain) : await WorkerTts.create({ module: new URL("./kokoro-core.mjs", import.meta.url), options: plain }));
    } catch (err) {
      throw err instanceof TtsError ? err : new TtsError((err as Error).message, { cause: err });
    }
  }

  get voices(): string[] {
    return this.inner.voices;
  }

  async *synthesize(request: SynthesisRequest): AsyncGenerator<AudioChunk> {
    try {
      yield* this.inner.synthesize(request);
    } catch (err) {
      throw err instanceof TtsError ? err : new TtsError((err as Error).message, { cause: err });
    }
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
