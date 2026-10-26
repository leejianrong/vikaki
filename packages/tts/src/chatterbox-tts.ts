// Chatterbox (Resemble AI, MIT) on a server of your own, such as a RunPod pod (VIK-143, docs/spikes/chatterbox.md). The server (`spikes/chatterbox/server.py`)
// answers `POST /v1/audio/speech` with 16-bit PCM, one whole piece of speech at a time: Chatterbox makes a sentence in one go, it does not stream inside one.
// So this adapter does the streaming the way Kokoro's does: it cuts a long sentence into pieces, asks for each piece, and yields each piece's audio as one chunk
// carrying its `text`, which is what lets the hub time the phonemes for `--phonemes` (ADR-0049). The next piece is requested while the last one is yielded.
//
// The key, if the server has one, comes from an environment variable and goes only into the Authorization header (SpeechApiTts does that and scrubs errors).
import { splitLong } from "./split-text.mjs";
import { PROVIDERS, SpeechApiTts, type SpeechApiOptions } from "./speech-api-tts.ts";
import type { AudioChunk, SynthesisRequest, Tts } from "./types.ts";

export interface ChatterboxOptions extends Partial<SpeechApiOptions> {
  /** The longest piece asked for in one request, in characters. Default 200. */
  maxPieceChars?: number;
}

/**
 * What an emotion becomes for Chatterbox: `exaggeration` (0.25 flat to 2 dramatic, default 0.5) and `cfg_weight` (lower is slower and more deliberate, default 0.5).
 * Starting values from Chatterbox's own advice, to be tuned by listening (docs/spikes/chatterbox.md).
 */
export function chatterboxParams(emotion: string | undefined, thought?: boolean): { exaggeration: number; cfg_weight: number } {
  const by: Record<string, [number, number]> = {
    neutral: [0.5, 0.5],
    happy: [0.7, 0.5],
    excited: [0.9, 0.35],
    sad: [0.55, 0.3],
    angry: [0.85, 0.4],
    worried: [0.6, 0.35],
    surprised: [0.85, 0.4],
    smug: [0.65, 0.3],
    nervous: [0.7, 0.4],
    confident: [0.6, 0.45],
  };
  const [exaggeration, cfg_weight] = by[emotion ?? "neutral"] ?? by.neutral!;
  return thought ? { exaggeration: Math.max(0.3, exaggeration - 0.15), cfg_weight: Math.max(0.2, cfg_weight - 0.1) } : { exaggeration, cfg_weight };
}

export class ChatterboxTts implements Tts {
  readonly name = "chatterbox";
  private readonly api: SpeechApiTts;
  private readonly maxPiece: number;

  constructor(options: ChatterboxOptions = {}) {
    const { maxPieceChars, ...rest } = options;
    this.maxPiece = maxPieceChars ?? 200;
    this.api = new SpeechApiTts({
      ...PROVIDERS.chatterbox(),
      // `style` is words, which Chatterbox does not read (the server ignores `instructions`); the emotion goes as numbers.
      bodyFor: (req) => chatterboxParams(req.emotion, req.style?.startsWith("Muttering")),
      ...rest,
    });
  }

  async *synthesize(req: SynthesisRequest): AsyncIterable<AudioChunk> {
    const pieces = splitLong(req.text.trim(), this.maxPiece);
    if (!pieces.length) return;
    const piece = (text: string) => this.collect({ ...req, text });
    let next = piece(pieces[0]!);
    next.catch(() => {}); // a failure is thrown where it is awaited, not as an unhandled rejection if we stop early
    for (let i = 0; i < pieces.length; i++) {
      const current = next;
      if (i + 1 < pieces.length && !req.signal?.aborted) {
        next = piece(pieces[i + 1]!);
        next.catch(() => {});
      }
      const audio = await current;
      if (req.signal?.aborted) return;
      if (audio) yield audio;
    }
  }

  /** One piece's audio as a single chunk with the words it says. */
  private async collect(req: SynthesisRequest): Promise<AudioChunk | undefined> {
    const parts: Float32Array[] = [];
    let rate = 24000;
    for await (const chunk of this.api.synthesize(req)) {
      parts.push(chunk.samples);
      rate = chunk.sampleRate;
    }
    const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) (samples.set(p, at), (at += p.length));
    return samples.length ? { samples, sampleRate: rate, text: req.text } : undefined;
  }
}
