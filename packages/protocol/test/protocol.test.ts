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
