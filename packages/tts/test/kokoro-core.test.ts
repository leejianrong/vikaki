import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
  return { href, calls: async () => (await import(href)).calls as string[] };
}

const LONG = "When the committee finally met on Tuesday morning to discuss the budget, nobody had read the report that everybody had been sent, so the meeting ran long, and several people left before it ended, which surprised no one at all.";

describe("the Kokoro engine and long sentences", () => {
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
