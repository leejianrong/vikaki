import { describe, expect, it } from "vitest";
import { FakeTts, KokoroTts, TtsError, synthVowel, type AudioChunk } from "../src/index.ts";

async function collect(it: AsyncIterable<AudioChunk>): Promise<AudioChunk[]> {
  const out: AudioChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}
const seconds = (chunks: AudioChunk[]) => chunks.reduce((s, c) => s + c.samples.length / c.sampleRate, 0);

describe("FakeTts", () => {
  it("speaks for a predictable time, in chunks, at the configured rate", async () => {
    const tts = new FakeTts({ sampleRate: 16000, msPerChar: 50, chunkMs: 100 });
    const chunks = await collect(tts.synthesize({ text: "x".repeat(40) })); // 2.0 s
    expect(seconds(chunks)).toBeCloseTo(2, 2);
    expect(chunks.length).toBe(20);
    expect(chunks.every((c) => c.sampleRate === 16000)).toBe(true);
    expect(tts.durationOf("x".repeat(40))).toBe(2);
  });

  it("speaks very short text for at least 300 ms", async () => {
    expect(seconds(await collect(new FakeTts().synthesize({ text: "Hi" })))).toBeCloseTo(0.3, 2);
  });

  it("is deterministic: same text, same samples", async () => {
    const a = await collect(new FakeTts().synthesize({ text: "hello world" }));
    const b = await collect(new FakeTts().synthesize({ text: "hello world" }));
    expect(a.map((c) => Array.from(c.samples.slice(0, 20)))).toEqual(b.map((c) => Array.from(c.samples.slice(0, 20))));
  });

  it("makes audible audio that stays within [-1, 1]", async () => {
    const all = (await collect(new FakeTts().synthesize({ text: "a longer line to speak out loud" }))).flatMap((c) => Array.from(c.samples));
    const peak = Math.max(...all.map(Math.abs));
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("records what it was asked to say, in order", async () => {
    const tts = new FakeTts();
    await collect(tts.synthesize({ text: "one" }));
    await collect(tts.synthesize({ text: "two" }));
    expect(tts.requests).toEqual(["one", "two"]);
  });

  it("stops promptly when aborted mid-speech, without an error", async () => {
    const ctrl = new AbortController();
    const got: AudioChunk[] = [];
    for await (const c of new FakeTts().synthesize({ text: "x".repeat(200), signal: ctrl.signal })) {
      got.push(c);
      if (got.length === 3) ctrl.abort();
    }
    expect(got.length).toBe(3);
  });

  it("yields nothing when already aborted, even with a start-up delay", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const t0 = Date.now();
    const chunks = await collect(new FakeTts({ firstChunkDelayMs: 2000 }).synthesize({ text: "hello", signal: ctrl.signal }));
    expect(chunks).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("waits the configured delay before the first chunk", async () => {
    const t0 = Date.now();
    const it = new FakeTts({ firstChunkDelayMs: 120 }).synthesize({ text: "hello" })[Symbol.asyncIterator]();
    await it.next();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });

  it("fails on demand with a TtsError whose code is tts_failed", async () => {
    const tts = new FakeTts({ failOn: /boom/ });
    await expect(collect(tts.synthesize({ text: "this will boom" }))).rejects.toMatchObject({ code: "tts_failed", name: "TtsError" });
    await expect(collect(tts.synthesize({ text: "this is fine" }))).resolves.toBeDefined();
    await expect(collect(new FakeTts({ failOn: "bad" }).synthesize({ text: "a bad line" }))).rejects.toBeInstanceOf(TtsError);
  });
});

describe("synthVowel", () => {
  it("has the requested length and never exceeds 0.3 in amplitude", () => {
    const x = synthVowel(0.5, 16000);
    expect(x.length).toBe(8000);
    expect(Math.max(...Array.from(x).map(Math.abs))).toBeLessThanOrEqual(0.3001);
  });
});

describe("KokoroTts", () => {
  it("explains how to install the optional package when it is missing", async () => {
    const err = await KokoroTts.create({ importFrom: "kokoro-js-that-is-not-installed" }).catch((e) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect(err.message).toContain("npm install kokoro-js");
    expect(err.message).toContain("--onnxruntime-node-install-cuda=skip");
  });

  // Manual: needs the real package and a model download. VIKAKI_KOKORO_PATH points at kokoro-js's entry file.
  it.skipIf(!process.env.VIKAKI_KOKORO_PATH)("speaks with the real engine", async () => {
    const tts = await KokoroTts.create({ importFrom: process.env.VIKAKI_KOKORO_PATH! });
    const chunks = await collect(tts.synthesize({ text: "Hello there, shall we begin?" }));
    expect(chunks[0]!.sampleRate).toBe(24000);
    expect(seconds(chunks)).toBeGreaterThan(1);
    expect(Math.max(...Array.from(chunks[0]!.samples).map(Math.abs))).toBeGreaterThan(0.05);
    expect(tts.voices).toContain("af_heart");
  }, 120_000);
});
