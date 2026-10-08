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
  ErrorMessage,
]);
export type Message = z.infer<typeof Message>;
export type MessageType = Message["type"];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** What each role may send after `hello`. The hub enforces this. */
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
