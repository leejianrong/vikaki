import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { create } from "../src/kokoro-core.mjs";

/** A stand-in for kokoro-js: each `generate` call takes a moment and is counted, and returns audio as long as its text. */
async function fakeKokoro() {
  const dir = await mkdtemp(join(tmpdir(), "vikaki-fake-kokoro-"));
  const file = join(dir, "fake-kokoro.mjs");
  await writeFile(
    file,
    `export const calls = [];
     export class KokoroTTS {
       static async from_pretrained() { return new KokoroTTS(); }
       voices = { af_heart: {} };
       async generate(text) {
         calls.push(text);
         if (globalThis.__blocking) { const end = Date.now() + 15; while (Date.now() < end); } // native work that holds the thread, as Kokoro's does
         else await new Promise((r) => setTimeout(r, 15));
         // the words (a tone as long as the text), padded with 0.4 s of quiet at each end, as Kokoro's calls are
         const rate = 24000, pad = Math.round(0.4 * rate), body = text.length * 50;
         const audio = new Float32Array(pad + body + pad);
         for (let i = 0; i < body; i++) audio[pad + i] = 0.3 * Math.sin(i / 7) + 0.31 * Math.sign(Math.sin(i / 7)); // never near zero
         return { audio, sampling_rate: rate };
       }
     }`,
  );
  const href = pathToFileURL(file).href;
  const raw = async () => (await import(href)).calls as string[];
  // `calls` is what was made for the lines spoken; the warm-up at load ("Ready.") is counted apart
  return { href, calls: async () => (await raw()).filter((t) => t !== "Ready."), raw };
}

const LONG = "When the committee finally met on Tuesday morning to discuss the budget, nobody had read the report that everybody had been sent, so the meeting ran long, and several people left before it ended, which surprised no one at all.";

describe("the Kokoro engine and long sentences", () => {
  it("warms up once when it loads, so the first line a player speaks does not pay for the runtime's set-up (VIK-116)", async () => {
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    expect(await fake.raw()).toEqual(["Ready."]);
    for await (const _ of engine.synthesize({ text: "Check." })) void _;
    expect(await fake.raw()).toEqual(["Ready.", "Check."]);
  });

  it("makes the first piece of a long line short, so sound starts sooner", async () => {
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    for await (const _ of engine.synthesize({ text: LONG })) void _;
    const calls = await fake.calls();
    expect(calls[0]!.length).toBeLessThanOrEqual(50);
    expect(Math.max(...calls.slice(1).map((t) => t.length))).toBeGreaterThan(50); // later pieces are the usual size
  });

  it("makes a long sentence in several smaller calls, so a cancel can land between them", async () => {
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    const chunks = [];
    for await (const c of engine.synthesize({ text: LONG })) chunks.push(c);
    const calls = await fake.calls();
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((t) => t.length <= 100)).toBe(true);
    expect(calls.join(" ").replace(/\s+/g, " ")).toBe(LONG); // nothing lost, nothing repeated
    expect(chunks).toHaveLength(calls.length); // each piece's audio is delivered as soon as it is made
  });

  it("does not leave long silences where the pieces join: each call's padding is trimmed and a natural pause put back", async () => {
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    const chunks = [];
    for await (const c of engine.synthesize({ text: LONG })) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(2);
    const rate = chunks[0]!.sampleRate;
    const all = Float32Array.from(chunks.flatMap((c) => [...c.samples]));
    // the longest run of quiet inside the sentence (not counting the padding at the line's own start and end)
    const inside = all.subarray(Math.round(0.4 * rate) + 10, all.length - Math.round(0.4 * rate) - 10);
    let longest = 0;
    let run = 0;
    for (const v of inside) {
      run = Math.abs(v) < 0.005 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    // a comma pause is 0.25 s plus the two 0.03 s margins; untrimmed, a join was 0.8 s
    expect(longest / rate, `longest quiet inside the sentence: ${(longest / rate).toFixed(2)} s`).toBeLessThan(0.45);
    // and the line's own start and end keep the padding the engine made
    expect(Math.abs(chunks[0]!.samples[10]!)).toBeLessThan(0.005);
    expect(Math.abs(chunks.at(-1)!.samples.at(-10)!)).toBeLessThan(0.005);
    expect(chunks[0]!.samples.length).toBeGreaterThan(Math.round(0.4 * rate)); // not trimmed at the front
  });

  it("stops after the piece in progress when aborted: no further calls are made", async () => {
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    const controller = new AbortController();
    const seen = [];
    for await (const c of engine.synthesize({ text: LONG, signal: controller.signal })) {
      seen.push(c);
      controller.abort(); // cancelled right after the first piece
    }
    expect(seen).toHaveLength(1);
    expect((await fake.calls()).length).toBe(1); // the pieces after the first were never made
  });

  it("sees an abort that arrives while the engine's work holds the thread, between one piece and the next", async () => {
    // A message to a worker thread is only handled when the thread's event loop turns. Kokoro's work holds the thread, and awaiting its
    // result continues in a microtask, so without yielding the loop the abort is not seen until every piece has been made.
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    (globalThis as unknown as { __blocking: boolean }).__blocking = true;
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5); // arrives as a macrotask while the first piece is being made
      const seen = [];
      for await (const c of engine.synthesize({ text: LONG, signal: controller.signal })) seen.push(c);
      const calls = await fake.calls();
      expect(calls.length, `${calls.length} pieces made after an abort 5 ms in`).toBeLessThanOrEqual(2);
    } finally {
      (globalThis as unknown as { __blocking: boolean }).__blocking = false;
    }
  });

  it("makes nothing at all when it is already aborted", async () => {
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    const controller = new AbortController();
    controller.abort();
    for await (const _ of engine.synthesize({ text: LONG, signal: controller.signal })) throw new Error("should not yield");
    expect(await fake.calls()).toEqual([]);
  });

  it("leaves a short sentence as one call", async () => {
    const fake = await fakeKokoro();
    const engine = await create({ importFrom: fake.href });
    for await (const _ of engine.synthesize({ text: "Hello there, friend." }));
    expect(await fake.calls()).toEqual(["Hello there, friend."]);
  });
});

describe("phonemes from the Kokoro engine (VIK-50)", () => {
  /** Put a stand-in `phonemizer` next to the fake kokoro-js, where the engine looks for the one kokoro-js comes with. */
  async function withPhonemizer(href: string, body: string) {
    const dir = join(fileURLToPath(href), "..", "node_modules", "phonemizer");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "phonemizer", main: "index.cjs" }));
    await writeFile(join(dir, "index.cjs"), body);
  }
  const say = async (engine: Awaited<ReturnType<typeof create>>, text: string, voice?: string) => {
    const out = [];
    for await (const c of engine.synthesize({ text, voice })) out.push(c);
    return out;
  };

  it("asks the phonemizer for each piece, in the voice's language, and sends the phrases with the audio", async () => {
    const fake = await fakeKokoro();
    await withPhonemizer(fake.href, `exports.calls = []; exports.phonemize = async (text, lang) => { exports.calls.push([text, lang]); return ["a" + text.length, "b"]; };`);
    const engine = await create({ importFrom: fake.href, phonemes: true });
    const chunks = await say(engine, "Hello there.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.phonemes).toBe("a12, b");
    const calls = createRequire(fake.href)("phonemizer").calls as [string, string][];
    expect(calls.filter(([t]) => t !== "Ready.")).toEqual([["Hello there.", "en-us"]]);
  });

  it("is off unless asked for: no phonemizer is even loaded, and the chunks carry none", async () => {
    const fake = await fakeKokoro();
    await withPhonemizer(fake.href, `throw new Error("must not be loaded");`);
    const chunks = await say(await create({ importFrom: fake.href }), "Hello there.");
    expect(chunks[0]!.phonemes).toBeUndefined();
  });

  it("speaks on without phonemes when there is no phonemizer, or it fails", async () => {
    const none = await fakeKokoro();
    expect((await say(await create({ importFrom: none.href, phonemes: true }), "Hello."))[0]!.phonemes).toBeUndefined();
    const broken = await fakeKokoro();
    await withPhonemizer(broken.href, `exports.phonemize = async (t) => { if (t !== "Ready.") throw new Error("espeak died"); return ["x"]; };`);
    const chunks = await say(await create({ importFrom: broken.href, phonemes: true }), "Hello.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.phonemes).toBeUndefined();
    expect(chunks[0]!.samples.length).toBeGreaterThan(0);
  });
});
