// A speech engine behind an OpenAI-style `POST {baseUrl}/audio/speech` endpoint (VIK-140): OpenAI's own gpt-4o-mini-tts, or a Chatterbox or Qwen3-TTS server
// that you run (on RunPod, say) and that speaks the same API. One adapter, so the bench and the hub can swap providers by options alone.
//
// The key comes from an environment variable named in the options, goes only into the `Authorization` header, and is never put into an error message or a log
// (a server that echoes the request in its error body has the key scrubbed from it). Nothing here runs in tests against a real service: tests give `fetch`.
import { TtsError, type AudioChunk, type SynthesisRequest, type Tts } from "./types.ts";

export interface SpeechApiOptions {
  /** Shown in logs and errors; the provider's short name. */
  name: string;
  /** Up to and including `/v1` (no trailing slash needed): the request goes to `${baseUrl}/audio/speech`. */
  baseUrl: string;
  model: string;
  /** Name of the environment variable holding the key. Not needed for a server on your own machine that takes none. */
  apiKeyEnv?: string;
  /** False for a server of your own that works without a key (the variable is still used when set). Default true. */
  keyRequired?: boolean;
  /** Only for tests and for callers that already hold the key; the environment variable is the normal way. */
  apiKey?: string;
  /** Sample rate of the raw 16-bit mono PCM the server answers with. OpenAI's is 24000. */
  sampleRate?: number;
  /** Engine voice used when the request names none, or one that is not in `voiceMap` and is not a voice of this provider. */
  defaultVoice: string;
  /** From the personas' voice ids (Kokoro names such as `af_heart`) to this provider's voices. */
  voiceMap?: Record<string, string>;
  /** Extra JSON fields for the body: `speed`, or whatever a self-hosted server takes. */
  extraBody?: Record<string, unknown>;
  /** Extra JSON fields worked out from each request (an engine whose emotion control is a number); merged after `extraBody`. */
  bodyFor?: (req: SynthesisRequest) => Record<string, unknown>;
  /** Cut the style to this many characters (the provider's limit). */
  maxStyleChars?: number;
  /** Give up on one request after this many milliseconds (an error, not a hang). Default: none. */
  timeoutMs?: number;
  /** How many more times to ask for the same text after a dropped connection, a time-out or an HTTP 429/5xx, before any audio of it has played. Default 0. */
  retries?: number;
  /** Wait before a retry, times the attempt number. Default 300. */
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

/** A refusal that asking again will not change: any 4xx but "too many requests" and "request timeout". */
const permanent = (status: number) => status >= 400 && status < 500 && status !== 429 && status !== 408;

const scrub = (text: string, secret: string | undefined) => (secret ? text.split(secret).join("[key]") : text).slice(0, 300);

export class SpeechApiTts implements Tts {
  readonly name: string;
  private readonly rate: number;

  constructor(private readonly o: SpeechApiOptions) {
    this.name = o.name;
    this.rate = o.sampleRate ?? 24000;
  }

  private key(): string | undefined {
    return this.o.apiKey ?? (this.o.apiKeyEnv ? process.env[this.o.apiKeyEnv] : undefined);
  }

  async *synthesize(req: SynthesisRequest): AsyncIterable<AudioChunk> {
    const key = this.key();
    if (this.o.apiKeyEnv && this.o.keyRequired !== false && !key) throw new TtsError(`${this.name}: the environment variable ${this.o.apiKeyEnv} is not set`);
    const voice = (req.voice && this.o.voiceMap?.[req.voice]) ?? this.o.defaultVoice;
    const style = req.style && this.o.maxStyleChars ? req.style.slice(0, this.o.maxStyleChars) : req.style;
    const body = { model: this.o.model, input: req.text, voice, response_format: "pcm", ...(style ? { instructions: style } : {}), ...this.o.extraBody, ...this.o.bodyFor?.(req) };
    const url = `${this.o.baseUrl.replace(/\/+$/, "")}/audio/speech`;
    const attempts = 1 + Math.max(0, this.o.retries ?? 0);
    let res: Response | undefined;
    let failure = "";
    for (let attempt = 1; attempt <= attempts && !res; attempt++) {
      if (attempt > 1) {
        await new Promise((r) => setTimeout(r, (this.o.retryDelayMs ?? 300) * (attempt - 1)));
        if (req.signal?.aborted) return;
      }
      const timeout = this.o.timeoutMs ? AbortSignal.timeout(this.o.timeoutMs) : undefined;
      const signal = req.signal && timeout ? AbortSignal.any([req.signal, timeout]) : (req.signal ?? timeout);
      let got: Response;
      try {
        got = await (this.o.fetch ?? fetch)(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (req.signal?.aborted) return;
        failure = timeout?.aborted ? `timed out after ${this.o.timeoutMs} ms` : `could not reach the server (${scrub(String((err as Error)?.message ?? err), key)})`;
        continue;
      }
      if (got.ok) {
        res = got;
        break;
      }
      const detail = await got.text().catch(() => "");
      failure = `HTTP ${got.status}${detail ? ` ${scrub(detail, key)}` : ""}`;
      if (permanent(got.status)) break;
    }
    if (!res) throw new TtsError(`${this.name}: ${failure}`);
    if (!res.body) throw new TtsError(`${this.name}: the answer had no audio`);
    const reader = res.body.getReader();
    let carry: Uint8Array = new Uint8Array(0);
    let first = true;
    try {
      for (;;) {
        let r: ReadableStreamReadResult<Uint8Array>;
        try {
          r = await reader.read();
        } catch (err) {
          if (req.signal?.aborted) return;
          throw new TtsError(`${this.name}: the audio stream broke (${scrub(String((err as Error)?.message ?? err), key)})`);
        }
        if (r.done) break;
        let bytes = carry.length ? concat(carry, r.value) : r.value;
        if (first) {
          first = false;
          bytes = stripWavHeader(bytes); // a server that ignores `pcm` and answers with a WAV file still plays
        }
        const usable = bytes.length - (bytes.length % 2);
        carry = bytes.slice(usable);
        if (usable > 0) yield { samples: toFloat(bytes, usable), sampleRate: this.rate };
        if (req.signal?.aborted) return;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** The samples of a WAV file's `data` chunk if `bytes` starts like one, else `bytes` as they are. Only the first read is looked at, so a header split across reads is not found. */
function stripWavHeader(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 44 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF") return bytes;
  for (let i = 12; i + 8 <= bytes.length; ) {
    const id = String.fromCharCode(...bytes.subarray(i, i + 4));
    const size = new DataView(bytes.buffer, bytes.byteOffset + i + 4, 4).getUint32(0, true);
    if (id === "data") return bytes.subarray(i + 8);
    i += 8 + size + (size % 2);
  }
  return bytes.subarray(44);
}

function toFloat(bytes: Uint8Array, length: number): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);
  const out = new Float32Array(length / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** The three providers Jian is choosing between, as options: each reads its key from the named variable and says where it goes. */
export const PROVIDERS = {
  /** OpenAI's gpt-4o-mini-tts: `instructions` is free text for tone. Key in OPENAI_API_KEY. */
  openai: (o: Partial<SpeechApiOptions> = {}): SpeechApiOptions => ({
    name: "openai-gpt-4o-mini-tts",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini-tts",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultVoice: "coral",
    maxStyleChars: 400,
    voiceMap: { af_heart: "coral", am_adam: "onyx", bf_emma: "shimmer", af_bella: "nova", am_michael: "echo" },
    ...o,
  }),
  /** A Chatterbox server (for example on a RunPod pod) with an OpenAI-style speech route: set CHATTERBOX_URL to its `/v1`. Its `exaggeration` knob carries the emotion. */
  chatterbox: (o: Partial<SpeechApiOptions> = {}): SpeechApiOptions => ({
    name: "chatterbox",
    baseUrl: process.env.CHATTERBOX_URL ?? "http://127.0.0.1:8004/v1",
    model: "chatterbox",
    apiKeyEnv: "CHATTERBOX_API_KEY",
    keyRequired: false,
    defaultVoice: "default",
    ...o,
  }),
  /** A Qwen3-TTS server (Apache-2.0) with an OpenAI-style speech route: set QWEN_TTS_URL to its `/v1`. Its free-text `instruct` is taken from `instructions`. */
  qwen: (o: Partial<SpeechApiOptions> = {}): SpeechApiOptions => ({
    name: "qwen3-tts",
    baseUrl: process.env.QWEN_TTS_URL ?? "http://127.0.0.1:8005/v1",
    model: "qwen3-tts",
    apiKeyEnv: "QWEN_TTS_API_KEY",
    keyRequired: false,
    defaultVoice: "Vivian",
    ...o,
  }),
} as const;
