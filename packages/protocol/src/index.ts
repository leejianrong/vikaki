import { z } from "zod";

/** Bump when a change is not backwards compatible. Every message carries it (ADR-0001). */
export const PROTOCOL_VERSION = 1;

/** The fixed emotion vocabulary (PLAN, Q19). An unknown value is treated as `neutral`, never an error. */
export const EMOTIONS = ["neutral", "happy", "smug", "worried", "surprised", "sad", "angry"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const UTTERANCE_KINDS = ["banter", "clue", "table_talk"] as const;
export const OUTCOMES = ["won", "lost", "drew"] as const;
export const INTERRUPT_REASONS = ["cancelled", "superseded", "human_spoke", "driver_disconnected"] as const;
export const ERROR_CODES = [
  "bad_message",
  "unsupported_protocol_version",
  "unauthorized",
  "driver_busy",
  "not_allowed",
  "unknown_persona",
  "tts_failed",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const id = z.string().min(1).max(128);
const common = {
  protocol_version: z.literal(PROTOCOL_VERSION),
  /** Optional room or match id, so one hub can serve several sessions later (Q29). */
  session_id: z.string().min(1).max(128).optional(),
};

// ---- sent by a client when it connects, and the hub's answer ----

export const Hello = z.object({
  ...common,
  type: z.literal("hello"),
  role: z.enum(["driver", "viewer"]),
  /** Driver credential, required when the hub was started with a token. */
  token: z.string().max(256).optional(),
  /** Free text such as "vikaki-cli/0.1", for logs. */
  client: z.string().max(64).optional(),
});

export const Welcome = z.object({
  ...common,
  type: z.literal("welcome"),
  role: z.enum(["driver", "viewer"]),
  /** The hub's speech engine, such as "kokoro" or "fake", or "off". For display. */
  speech: z.string().max(64).optional(),
  /** The default voice of that engine, such as "af_heart". For display. */
  voice: z.string().max(64).optional(),
});

// ---- from the driver (a game, an LLM, a script) ----

export const Utterance = z
  .object({
    ...common,
    type: z.literal("utterance"),
    seat_id: id,
    utterance_id: id,
    /** The whole line, when it is known up front. */
    text: z.string().min(1).max(5000).optional(),
    /** One chunk of a line still being written. Send chunks in order, ending with `final: true`. */
    delta: z.string().min(1).max(5000).optional(),
    final: z.boolean().optional(),
    emotion: z.string().max(32).optional(),
    intensity: z.number().min(0).max(1).optional(),
    persona: z.string().min(1).max(64).optional(),
    kind: z.enum(UTTERANCE_KINDS).optional(),
  })
  .refine((m) => (m.text === undefined) !== (m.delta === undefined), { message: "send exactly one of `text` or `delta`" })
  .refine((m) => m.text === undefined || m.final === undefined, { message: "`final` only goes with `delta`" });

export const Cancel = z.object({ ...common, type: z.literal("cancel"), utterance_id: id });
export const TurnStarted = z.object({ ...common, type: z.literal("turn_started"), seat_id: id });
export const TurnEnded = z.object({ ...common, type: z.literal("turn_ended"), seat_id: id });
export const GameOver = z.object({ ...common, type: z.literal("game_over"), outcome: z.enum(OUTCOMES), seat_id: id.optional() });

// ---- back to the driver, reported by whoever plays the audio ----

export const SpeechStarted = z.object({ ...common, type: z.literal("speech_started"), utterance_id: id, seat_id: id.optional() });
export const SpeechFinished = z.object({ ...common, type: z.literal("speech_finished"), utterance_id: id });
export const SpeechInterrupted = z.object({
  ...common,
  type: z.literal("speech_interrupted"),
  utterance_id: id,
  reason: z.enum(INTERRUPT_REASONS),
});
export const ErrorMessage = z.object({
  ...common,
  type: z.literal("error"),
  code: z.enum(ERROR_CODES),
  message: z.string().max(500),
  utterance_id: id.optional(),
});

// ---- from the hub to viewers only: the speech to play ----

/** Longest base64 audio payload in one message (about 1.4 MB, over 15 s of 24 kHz speech). */
export const MAX_AUDIO_B64 = 2_000_000;

/** Longest text of one spoken piece. A piece is a sentence, or a clause of a long one. */
export const MAX_SENTENCE_TEXT = 4000;

/**
 * A slice of speech. `pcm` is base64 of 16-bit little-endian mono samples. Slices of one utterance
 * arrive in `seq` order; the last has `final: true` and may carry no samples. `sentence_index` says which
 * spoken piece of the utterance a slice belongs to, and `sentence_text` carries that piece's text on the first
 * slice of each piece only. Both are optional, so a hub without them still works and older pages ignore them.
 */
export const AudioMessage = z.object({
  ...common,
  type: z.literal("audio"),
  utterance_id: id,
  seat_id: id.optional(),
  seq: z.number().int().min(0),
  sample_rate: z.number().int().min(8000).max(48000),
  pcm: z.string().max(MAX_AUDIO_B64),
  final: z.boolean(),
  sentence_index: z.number().int().min(0).optional(),
  sentence_text: z.string().max(MAX_SENTENCE_TEXT).optional(),
});

export const Message = z.discriminatedUnion("type", [
  Hello,
  Welcome,
  Utterance,
  Cancel,
  TurnStarted,
  TurnEnded,
  GameOver,
  SpeechStarted,
  SpeechFinished,
  SpeechInterrupted,
  AudioMessage,
  ErrorMessage,
]);
export type Message = z.infer<typeof Message>;
export type MessageType = Message["type"];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** What each role may send after `hello`. The hub enforces this. `audio` is sent by the hub only. */
export const DRIVER_MAY_SEND: readonly MessageType[] = ["utterance", "cancel", "turn_started", "turn_ended", "game_over"];
export const VIEWER_MAY_SEND: readonly MessageType[] = ["speech_started", "speech_finished", "speech_interrupted", "error"];

export type ParseResult = { ok: true; message: Message } | { ok: false; code: ErrorCode; message: string };

/** Parse one wire message (a JSON string or already-parsed value) with a clear error for each failure. */
export function parseMessage(raw: unknown): ParseResult {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, code: "bad_message", message: "message is not valid JSON" };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, code: "bad_message", message: "message must be a JSON object" };
  }
  const version = (value as { protocol_version?: unknown }).protocol_version;
  if (version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "unsupported_protocol_version",
      message: `this hub speaks protocol_version ${PROTOCOL_VERSION}, got ${JSON.stringify(version)}`,
    };
  }
  const parsed = Message.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, code: "bad_message", message: `${where}${issue?.message ?? "invalid message"}` };
  }
  return { ok: true, message: parsed.data };
}

/** Build a message with the protocol version filled in. */
export function make<T extends MessageType>(type: T, fields: Omit<MessageOf<T>, "type" | "protocol_version">): MessageOf<T> {
  return { protocol_version: PROTOCOL_VERSION, type, ...fields } as MessageOf<T>;
}

/** An unknown or missing emotion becomes `neutral`. */
export function normaliseEmotion(value: string | undefined): Emotion {
  return (EMOTIONS as readonly string[]).includes(value ?? "") ? (value as Emotion) : "neutral";
}

/** The JSON Schema published for non-TypeScript clients, such as a Python client. */
export function jsonSchema(): unknown {
  return z.toJSONSchema(Message, { target: "draft-2020-12" });
}

// ---- audio encoding, shared by the hub (encode) and avatar pages (decode) ----

/** Floats in [-1, 1] to base64 of 16-bit little-endian PCM. Values outside the range are clipped. */
export function encodePcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The reverse of `encodePcm16`. An empty string gives no samples. */
export function decodePcm16(base64: string): Float32Array {
  const binary = atob(base64);
  const view = new DataView(new ArrayBuffer(binary.length - (binary.length % 2)));
  for (let i = 0; i < view.byteLength; i++) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    const v = view.getInt16(i * 2, true);
    out[i] = v < 0 ? v / 32768 : v / 32767;
  }
  return out;
}
