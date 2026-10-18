import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePcm16, DRIVER_MAY_SEND, EMOTIONS, encodePcm16, jsonSchema, make, MAX_SENTENCE_TEXT, normaliseEmotion, parseMessage, PROTOCOL_VERSION, VIEWER_MAY_SEND } from "../src/index.ts";

const v = PROTOCOL_VERSION;

describe("parseMessage", () => {
  it("accepts a complete utterance and a streamed one", () => {
    expect(parseMessage({ protocol_version: v, type: "utterance", seat_id: "s1", utterance_id: "u1", text: "hi" }).ok).toBe(true);
    expect(parseMessage({ protocol_version: v, type: "utterance", seat_id: "s1", utterance_id: "u1", delta: "hel", final: false }).ok).toBe(true);
  });

  it("accepts a JSON string as well as an object", () => {
    const r = parseMessage(JSON.stringify({ protocol_version: v, type: "cancel", utterance_id: "u1" }));
    expect(r.ok && r.message.type).toBe("cancel");
  });

  it("rejects a different protocol version with its own code and a clear message", () => {
    const r = parseMessage({ protocol_version: 2, type: "cancel", utterance_id: "u1" });
    expect(r).toMatchObject({ ok: false, code: "unsupported_protocol_version" });
    expect(!r.ok && r.message).toContain("protocol_version 1");
    expect(parseMessage({ type: "cancel", utterance_id: "u1" })).toMatchObject({ ok: false, code: "unsupported_protocol_version" });
  });

  it("rejects what is not a JSON object", () => {
    for (const bad of ["not json", "[]", "42", "null", 7, null, []]) {
      expect(parseMessage(bad)).toMatchObject({ ok: false, code: "bad_message" });
    }
  });

  it("rejects unknown types and missing fields, naming the field", () => {
    expect(parseMessage({ protocol_version: v, type: "dance" })).toMatchObject({ ok: false, code: "bad_message" });
    const r = parseMessage({ protocol_version: v, type: "utterance", seat_id: "s1", text: "hi" });
    expect(!r.ok && r.message).toContain("utterance_id");
  });

  it("needs exactly one of text and delta, and `final` only with delta", () => {
    const base = { protocol_version: v, type: "utterance", seat_id: "s1", utterance_id: "u1" };
    expect(parseMessage(base).ok).toBe(false);
    expect(parseMessage({ ...base, text: "a", delta: "b" }).ok).toBe(false);
    expect(parseMessage({ ...base, text: "a", final: true }).ok).toBe(false);
  });

  it("rejects empty, oversized and out-of-range values", () => {
    const base = { protocol_version: v, type: "utterance", seat_id: "s1", utterance_id: "u1" };
    expect(parseMessage({ ...base, text: "" }).ok).toBe(false);
    expect(parseMessage({ ...base, text: "x".repeat(5001) }).ok).toBe(false);
    expect(parseMessage({ ...base, text: "hi", intensity: 1.5 }).ok).toBe(false);
    expect(parseMessage({ ...base, text: "hi", intensity: -0.1 }).ok).toBe(false);
    expect(parseMessage({ ...base, utterance_id: "u".repeat(129), text: "hi" }).ok).toBe(false);
  });

  it("does not choke on an unknown emotion: it passes validation and normalises to neutral", () => {
    const r = parseMessage({ protocol_version: v, type: "utterance", seat_id: "s", utterance_id: "u", text: "hi", emotion: "flabbergasted" });
    expect(r.ok).toBe(true);
    expect(normaliseEmotion("flabbergasted")).toBe("neutral");
  });
});

describe("normaliseEmotion", () => {
  it("keeps the seven known emotions and maps everything else to neutral", () => {
    for (const e of EMOTIONS) expect(normaliseEmotion(e)).toBe(e);
    for (const bad of [undefined, "", "Happy", "joy", "__proto__"]) expect(normaliseEmotion(bad as string | undefined)).toBe("neutral");
  });
});

describe("make", () => {
  it("fills in the protocol version and builds a valid message", () => {
    const m = make("speech_finished", { utterance_id: "u1" });
    expect(m).toEqual({ protocol_version: v, type: "speech_finished", utterance_id: "u1" });
    expect(parseMessage(m).ok).toBe(true);
  });
});

describe("who may send what", () => {
  it("keeps the driver and viewer sets separate", () => {
    expect(DRIVER_MAY_SEND.filter((t) => VIEWER_MAY_SEND.includes(t))).toEqual([]);
  });
});

describe("audio message and PCM encoding", () => {
  const audio = { protocol_version: v, type: "audio", utterance_id: "u1", seq: 0, sample_rate: 24000, pcm: "AAA=", final: false };

  it("accepts a slice, and a final slice with no samples", () => {
    expect(parseMessage(audio).ok).toBe(true);
    expect(parseMessage({ ...audio, pcm: "", final: true }).ok).toBe(true);
  });

  it("rejects a bad rate, a negative or fractional seq, and a missing flag", () => {
    expect(parseMessage({ ...audio, sample_rate: 100 }).ok).toBe(false);
    expect(parseMessage({ ...audio, seq: -1 }).ok).toBe(false);
    expect(parseMessage({ ...audio, seq: 1.5 }).ok).toBe(false);
    expect(parseMessage({ ...audio, final: undefined }).ok).toBe(false);
  });

  it("carries which spoken piece a slice belongs to, optionally", () => {
    expect(parseMessage({ ...audio, sentence_index: 2, sentence_text: "How are you?" }).ok).toBe(true);
    expect(parseMessage({ ...audio, sentence_index: 0 }).ok).toBe(true);
    expect(parseMessage({ ...audio, sentence_index: 0, sentence_end: true, pcm: "" }).ok).toBe(true); // a marker: this sentence's audio is complete
    expect(parseMessage({ ...audio, sentence_end: "yes" }).ok).toBe(false);
    expect(parseMessage({ ...audio, sentence_index: -1 }).ok).toBe(false);
    expect(parseMessage({ ...audio, sentence_index: 0.5 }).ok).toBe(false);
    expect(parseMessage({ ...audio, sentence_text: "x".repeat(MAX_SENTENCE_TEXT + 1) }).ok).toBe(false);
  });

  it("is not something a driver or a viewer may send", () => {
    expect(DRIVER_MAY_SEND).not.toContain("audio");
    expect(VIEWER_MAY_SEND).not.toContain("audio");
  });

  it("round-trips samples to within 16-bit precision", () => {
    const input = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7) * 0.8);
    const back = decodePcm16(encodePcm16(input));
    expect(back.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) expect(Math.abs(back[i]! - input[i]!)).toBeLessThan(1 / 16000);
  });

  it("clips out-of-range samples instead of wrapping around", () => {
    const back = decodePcm16(encodePcm16(Float32Array.from([2, -2, 1, -1, 0])));
    expect(Array.from(back)).toEqual([1, -1, 1, -1, 0]);
  });

  it("handles empty input and large input", () => {
    expect(decodePcm16(encodePcm16(new Float32Array(0))).length).toBe(0);
    expect(decodePcm16("").length).toBe(0);
    const big = new Float32Array(200_000).fill(0.25);
    expect(decodePcm16(encodePcm16(big)).length).toBe(200_000);
  });
});

describe("hello with seats", () => {
  const hello = (extra: Record<string, unknown>) => parseMessage({ protocol_version: v, type: "hello", role: "driver", ...extra });

  it("is optional, so an older driver's hello is still valid", () => {
    expect(hello({}).ok).toBe(true);
  });

  it("lists seats, each with a persona or none", () => {
    expect(hello({ seats: [{ seat_id: "seat-1", persona: "ada" }, { seat_id: "seat-2" }] }).ok).toBe(true);
  });

  it("rejects no seats, too many, and a seat without an id or with an empty persona", () => {
    expect(hello({ seats: [] }).ok).toBe(false);
    expect(hello({ seats: Array.from({ length: 17 }, (_, i) => ({ seat_id: `s${i}` })) }).ok).toBe(false);
    expect(hello({ seats: [{ persona: "ada" }] }).ok).toBe(false);
    expect(hello({ seats: [{ seat_id: "s", persona: "" }] }).ok).toBe(false);
  });
});

describe("welcome", () => {
  it("may say which speech engine the hub uses", () => {
    expect(parseMessage({ protocol_version: v, type: "welcome", role: "viewer", speech: "kokoro" }).ok).toBe(true);
    expect(parseMessage({ protocol_version: v, type: "welcome", role: "viewer" }).ok).toBe(true);
  });
});

describe("published JSON Schema", () => {
  it("matches docs/protocol.schema.json (run `pnpm --filter @vikaki/protocol schema` after changing the protocol)", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../docs/protocol.schema.json", import.meta.url)), "utf8");
    expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(jsonSchema())));
  });
});

describe("table_state", () => {
  const state = {
    protocol_version: 1,
    type: "table_state",
    pot: 120,
    street: "flop",
    board: ["As", "Td", "7c"],
    dealer: "seat-1",
    turn: "seat-2",
    seats: [
      { seat_id: "seat-1", stack: 880, bet: 40, cards: ["Kh", "Qh"] },
      { seat_id: "seat-2", stack: 940, folded: true, cards: ["back", "back"] },
    ],
  };

  it("is sent by a driver, and carries the pot, the board, the dealer, whose turn it is and each seat's stack", () => {
    expect(DRIVER_MAY_SEND).toContain("table_state");
    expect(parseMessage(state)).toMatchObject({ ok: true, message: { type: "table_state", pot: 120, board: ["As", "Td", "7c"], turn: "seat-2" } });
  });

  it("needs only the seats: the pot, board and the rest are optional, so a game that has no pot still works", () => {
    expect(parseMessage({ protocol_version: 1, type: "table_state", seats: [{ seat_id: "a", stack: 5 }] }).ok).toBe(true);
  });

  it("refuses a negative pot or stack, a seat twice, and a board that is too long", () => {
    expect(parseMessage({ ...state, pot: -1 }).ok).toBe(false);
    expect(parseMessage({ ...state, seats: [{ seat_id: "a", stack: -5 }] }).ok).toBe(false);
    expect(parseMessage({ ...state, seats: [{ seat_id: "a", stack: 1 }, { seat_id: "a", stack: 2 }] }).ok).toBe(false);
    expect(parseMessage({ ...state, board: ["As", "Td", "7c", "2h", "3h", "4h", "5h", "6h", "9h", "9d", "9s"] }).ok).toBe(false);
  });
});

describe("table_state spectator fields (VIK-83)", () => {
  const seat = (extra: object) => ({ protocol_version: 1, type: "table_state", seats: [{ seat_id: "a", stack: 5, ...extra }] });

  it("lets a seat carry its hand in words, its chance to win from 0 to 1, and its last action", () => {
    const r = parseMessage(seat({ hand: "pair of kings", win: 0.62, action: "raised to 12" }));
    expect(r).toMatchObject({ ok: true, message: { seats: [{ hand: "pair of kings", win: 0.62, action: "raised to 12" }] } });
  });

  it("refuses a chance outside 0 to 1 and empty or over-long words", () => {
    for (const bad of [{ win: -0.1 }, { win: 1.2 }, { hand: "" }, { action: "" }, { hand: "x".repeat(61) }, { action: "x".repeat(41) }, { win: "high" }]) {
      expect(parseMessage(seat(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("stays optional: an older game that sends none of them still works", () => {
    expect(parseMessage(seat({})).ok).toBe(true);
  });
});

describe("react", () => {
  it("is sent by a driver: a seat's emotion, with an optional gesture and hold time, and no speech", () => {
    expect(DRIVER_MAY_SEND).toContain("react");
    expect(parseMessage({ protocol_version: 1, type: "react", seat_id: "seat-2", emotion: "surprised", gesture: "shake", seconds: 2 })).toMatchObject({
      ok: true,
      message: { type: "react", seat_id: "seat-2", emotion: "surprised", gesture: "shake", seconds: 2 },
    });
    expect(parseMessage({ protocol_version: 1, type: "react", seat_id: "seat-2", emotion: "happy" }).ok).toBe(true);
    expect(parseMessage({ protocol_version: 1, type: "react", seat_id: "seat-2", gesture: "nod" }).ok).toBe(true); // a nod alone is a reaction
  });

  it("needs a seat and something to show, and refuses an unknown gesture or a hold time that is not a short wait", () => {
    expect(parseMessage({ protocol_version: 1, type: "react", emotion: "happy" }).ok).toBe(false);
    expect(parseMessage({ protocol_version: 1, type: "react", seat_id: "s" }).ok).toBe(false);
    expect(parseMessage({ protocol_version: 1, type: "react", seat_id: "s", gesture: "dance" }).ok).toBe(false);
    expect(parseMessage({ protocol_version: 1, type: "react", seat_id: "s", emotion: "happy", seconds: 0 }).ok).toBe(false);
    expect(parseMessage({ protocol_version: 1, type: "react", seat_id: "s", emotion: "happy", seconds: 60 }).ok).toBe(false);
  });
});
