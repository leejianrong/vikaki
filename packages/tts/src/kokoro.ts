import { TtsError, type AudioChunk, type SynthesisRequest, type Tts } from "./types.ts";

/** Just the parts of kokoro-js we use, so this package needs no copy of it to compile. */
interface KokoroInstance {
  generate(text: string, options: { voice?: string }): Promise<{ audio: Float32Array; sampling_rate: number }>;
  voices: Record<string, unknown>;
}
interface KokoroModule {
  KokoroTTS: { from_pretrained(model: string, options: { dtype: string; device: string }): Promise<KokoroInstance> };
}

export interface KokoroOptions {
  /** Hugging Face model id. */
  model?: string;
  /** Weight precision. q8 is about 90 MB and runs on CPU. */
  dtype?: "q8" | "q4" | "fp16" | "fp32";
  voice?: string;
  /** Where to import kokoro-js from. Defaults to the package name; tests can pass a file path. */
  importFrom?: string;
}

const INSTALL_HINT =
  "Local speech needs the optional kokoro-js package (Apache-2.0, about 400 MB with its runtime). " +
  "Install it next to Vikaki with: npm install kokoro-js --onnxruntime-node-install-cuda=skip " +
  "(the flag avoids an install error on machines with CUDA 11). The first run also downloads a model of about 90 MB.";

/**
 * Local text-to-speech with Kokoro (Apache-2.0 code and model), on CPU. Loaded on demand so that
 * everything else works without its large dependency. About 0.75x real time on a laptop CPU, so a
 * short first sentence takes roughly 1.5 s to produce.
 */
export class KokoroTts implements Tts {
  readonly name = "kokoro";
  private constructor(
    private readonly engine: KokoroInstance,
    private readonly defaultVoice: string,
  ) {}

  static async create(options: KokoroOptions = {}): Promise<KokoroTts> {
    const from: string = options.importFrom ?? "kokoro-js";
    let mod: KokoroModule;
    try {
      mod = (await import(/* @vite-ignore */ from)) as KokoroModule;
    } catch (err) {
      throw new TtsError(INSTALL_HINT, { cause: err });
    }
    try {
      const engine = await mod.KokoroTTS.from_pretrained(options.model ?? "onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: options.dtype ?? "q8",
        device: "cpu",
      });
      return new KokoroTts(engine, options.voice ?? "af_heart");
    } catch (err) {
      throw new TtsError(`could not load the Kokoro model: ${(err as Error).message}`, { cause: err });
    }
  }

  get voices(): string[] {
    return Object.keys(this.engine.voices);
  }

  async *synthesize(request: SynthesisRequest): AsyncGenerator<AudioChunk> {
    if (request.signal?.aborted) return;
    const voice = request.voice && this.voices.includes(request.voice) ? request.voice : this.defaultVoice;
    let result: { audio: Float32Array; sampling_rate: number };
    try {
      result = await this.engine.generate(request.text, { voice });
    } catch (err) {
      throw new TtsError(`Kokoro failed: ${(err as Error).message}`, { cause: err });
    }
    if (request.signal?.aborted) return; // cancelled while generating; the audio is no longer wanted
    yield { samples: result.audio, sampleRate: result.sampling_rate };
  }
}
