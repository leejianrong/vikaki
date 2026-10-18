import { z } from "zod";

/** Bump when a change is not backwards compatible. Every message carries it (ADR-0001). */
export const PROTOCOL_VERSION = 1;

/** The fixed emotion vocabulary (PLAN, Q19). An unknown value is treated as `neutral`, never an error. */
export const EMOTIONS = ["neutral", "happy", "smug", "worried", "surprised", "sad", "angry"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const UTTERANCE_KINDS = ["banter", "clue", "table_talk"] as const;
/** What a seat can do with its head when it reacts without speaking. */
export const GESTURES = ["nod", "shake", "tilt"] as const;
export type Gesture = (typeof GESTURES)[number];
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
  role: z.enum(["driver", "viewer", "controller"]),
  /** Driver or controller credential, required when the hub was started with a token. */
  token: z.string().max(256).optional(),
  /** Free text such as "vikaki-cli/0.1", for logs. */
  client: z.string().max(64).optional(),
  /** A viewer that shows one persona says so: it plays only that persona's lines. Without it, a viewer plays every line. */
  persona: z.string().min(1).max(64).optional(),
  /**
   * A driver that speaks for some seats only (one LLM at a poker table) lists them, each with the persona that seat uses. Several
   * such drivers may be connected at once, one per seat; a driver that lists none is the whole table's driver, as before. The hub
   * fills in a line's `persona` from its seat, and sends each driver only the reports for its own lines.
   */
  seats: z.array(z.object({ seat_id: id, persona: z.string().min(1).max(64).optional() })).min(1).max(16).optional(),
});

export const Welcome = z.object({
  ...common,
  type: z.literal("welcome"),
  role: z.enum(["driver", "viewer", "controller"]),
  /** The hub's speech engine, such as "kokoro" or "fake", or "off". For display. */
  speech: z.string().max(64).optional(),
  /** The default voice of that engine, such as "af_heart". For display. */
  voice: z.string().max(64).optional(),
  /** The personas the hub knows, when it was started with a personas file. A driver can check a name against it before sending. */
  personas: z.array(z.string().min(1).max(64)).max(256).optional(),
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

/** Without `utterance_id`, stop everything that is speaking or queued. */
export const Cancel = z.object({ ...common, type: z.literal("cancel"), utterance_id: id.optional() });
/** `persona` says whose turn it is, so a page showing one persona can tell; a page showing everyone ignores it. */
export const TurnStarted = z.object({ ...common, type: z.literal("turn_started"), seat_id: id, persona: z.string().min(1).max(64).optional() });
export const TurnEnded = z.object({ ...common, type: z.literal("turn_ended"), seat_id: id, persona: z.string().min(1).max(64).optional() });
export const GameOver = z.object({ ...common, type: z.literal("game_over"), outcome: z.enum(OUTCOMES), seat_id: id.optional() });

/** One card as the game names it, such as `As` or `Td`, or `back` for a card face down. The page only draws it; it knows no rules. */
const card = z.string().min(1).max(8);

/**
 * The state of a table game, for the overlay on a table page (ADR-0018, VIK-59). The game owns the truth and sends the whole state each
 * time it changes; a viewer draws the last one and keeps no game logic. Every field but `seats` is optional, so a game with no pot or no
 * board still works. A seat's `cards` are shown as sent: send `back` for a card the table must not see. Any driver may send it, and it
 * is for the whole table, so the last one wins.
 */
export const TableState = z
  .object({
    ...common,
    type: z.literal("table_state"),
    pot: z.number().min(0).optional(),
    /** The stage of the hand, for display: "preflop", "flop", "showdown". */
    street: z.string().min(1).max(32).optional(),
    board: z.array(card).max(10).optional(),
    /** The seat with the dealer button. */
    dealer: id.optional(),
    /** The seat whose turn it is, shown with a marker. */
    turn: id.optional(),
    seats: z
      .array(
        z.object({
          seat_id: id,
          stack: z.number().min(0),
          /** What the seat has put in this round. */
          bet: z.number().min(0).optional(),
          folded: z.boolean().optional(),
          cards: z.array(card).max(10).optional(),
          /** For a spectator panel (VIK-83): the seat's hand in words ("pair of kings"), its chance to win the pot from 0 to 1, and what it did last ("raised to 12"). The game works these out and sends them only when the table may see the cards. */
          hand: z.string().min(1).max(60).optional(),
          win: z.number().min(0).max(1).optional(),
          action: z.string().min(1).max(40).optional(),
        }),
      )
      .max(16),
  })
  .refine((m) => new Set(m.seats.map((s) => s.seat_id)).size === m.seats.length, { message: "a seat is listed twice" });

/**
 * A silent reaction (ADR-0018, VIK-58): a seat shows a feeling and perhaps nods, shakes its head or tilts it, without speaking, so it need not
 * wait in the speech queue behind whoever is talking. The feeling is one of the seven emotions (an unknown one shows as `neutral`, as on a line),
 * held for `seconds` (default 1.5) and then eased away. Send `emotion`, `gesture` or both. It is ignored while that seat is speaking or
 * thinking: a line's own feeling and a turn's thinking pose win. `persona` is filled in from the seat, as for turns.
 */
export const React = z
  .object({
    ...common,
    type: z.literal("react"),
    seat_id: id,
    persona: z.string().min(1).max(64).optional(),
    emotion: z.string().max(32).optional(),
    intensity: z.number().min(0).max(1).optional(),
    gesture: z.enum(GESTURES).optional(),
    seconds: z.number().min(0.2).max(10).optional(),
  })
  .refine((m) => m.emotion !== undefined || m.gesture !== undefined, { message: "send an `emotion`, a `gesture`, or both" });

/**
 * A private thought (VIK-93): what a seat is thinking before it acts, for the people watching, never for the other players. It is text only: the hub
 * does not speak it (a spoken line is an `utterance`, and the hub speaks every one of those). A driver sends it for its own seat; viewers get it with
 * `persona` filled in from the seat, as for turns. A table game's other seats never see it, because only viewers are sent what a driver sends.
 */
export const Thought = z.object({
  ...common,
  type: z.literal("thought"),
  seat_id: id,
  persona: z.string().min(1).max(64).optional(),
  text: z.string().min(1).max(1000),
});

/**
 * What a human said, as text, for a seat (ADR-0024, VIK-69). The speech-to-text is not here: whoever has the microphone (the page that frames
 * the avatar, or a game with its own recogniser) turns the speech into text and sends this. A viewer sends it (a driver may not: the
 * driver sets and the viewer sets stay apart) and the hub gives it to the driver of that seat; the whole table's driver gets every seat's.
 * It goes to that driver only, not to the other viewers. It is never spoken. `final: false` marks a partial transcript still being recognised; leave it out (or send
 * `true`) for the finished line.
 */
export const HumanUtterance = z.object({
  ...common,
  type: z.literal("human_utterance"),
  seat_id: id,
  text: z.string().min(1).max(2000),
  final: z.boolean().optional(),
});

// ---- back to the driver, reported by whoever plays the audio ----

export const SpeechStarted = z.object({ ...common, type: z.literal("speech_started"), utterance_id: id, seat_id: id.optional() });
/** What a viewer measured on its own clock, in ms from receiving the line. Reported, never gated. */
export const SpeechTiming = z.object({
  /** The line reached the page, to its first sound being heard. */
  audio_ms: z.number().min(0),
  /** The line reached the page, to the first rendered frame with the mouth open. Absent if the line ended first. */
  frame_ms: z.number().min(0).optional(),
});
export const SpeechFinished = z.object({ ...common, type: z.literal("speech_finished"), utterance_id: id, timing: SpeechTiming.optional() });
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
 * slice of each piece only. `sentence_end` marks, on an empty slice, that a piece's audio is complete. All are optional,
 * so a hub without them still works and older pages ignore them.
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
  /** On an empty slice sent after a piece's last audio: that piece is complete, so its words can be timed now. */
  sentence_end: z.boolean().optional(),
});

export const Message = z.discriminatedUnion("type", [
  Hello,
  Welcome,
  Utterance,
  Cancel,
  TurnStarted,
  TurnEnded,
  GameOver,
  TableState,
  React,
  Thought,
  HumanUtterance,
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
export const DRIVER_MAY_SEND: readonly MessageType[] = ["utterance", "cancel", "turn_started", "turn_ended", "game_over", "table_state", "react", "thought"];
/** A controller is not a driver: it never holds the driver slot and may only stop speech (`vikaki cancel`). */
export const CONTROLLER_MAY_SEND: readonly MessageType[] = ["cancel"];
export const VIEWER_MAY_SEND: readonly MessageType[] = ["speech_started", "speech_finished", "speech_interrupted", "error", "human_utterance"];

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
