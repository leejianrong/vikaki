import { afterEach, describe, expect, it } from "vitest";
import { TtsError, WorkerTts, type AudioChunk } from "../src/index.ts";

const module = new URL("./fixtures/test-engine.mjs", import.meta.url);
const open: WorkerTts[] = [];
const start = async (options?: unknown) => {
  const tts = await WorkerTts.create({ module, options });
  open.push(tts);
  return tts;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((t) => t.close()));
});

const collect = async (it: AsyncIterable<AudioChunk>) => {
  const out: AudioChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
};

describe("WorkerTts", () => {
  it("takes the engine's name and voices, and hands over its audio in order", async () => {
    const tts = await start();
    expect(tts.name).toBe("test-engine");
    expect(tts.voices).toEqual(["a", "b"]);
    const chunks = await collect(tts.synthesize({ text: "chunks:3", voice: "b" }));
    expect(chunks.map((c) => [c.samples.length, Math.fround(c.samples[0]!), c.sampleRate])).toEqual([
      [100, Math.fround(0.1), 16000],
      [100, Math.fround(0.2), 16000],
      [100, Math.fround(0.3), 16000],
    ]);
  });

  it("serves one request after another, and several at once without mixing them up", async () => {
    const tts = await start();
    const [a, b] = await Promise.all([collect(tts.synthesize({ text: "chunks:2" })), collect(tts.synthesize({ text: "chunks:4" }))]);
    expect([a.length, b.length]).toEqual([2, 4]);
    expect((await collect(tts.synthesize({ text: "chunks:1" }))).length).toBe(1);
  });

  it("reports an engine failure as a TtsError and carries on afterwards", async () => {
    const tts = await start();
    const err = await collect(tts.synthesize({ text: "fail" })).catch((e) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect(err.code).toBe("tts_failed");
    expect(err.message).toContain("the engine broke");
    expect((await collect(tts.synthesize({ text: "chunks:1" }))).length).toBe(1);
  });

  it("refuses to start when the engine cannot, saying why", async () => {
    const err = await WorkerTts.create({ module, options: { failToStart: true } }).catch((e) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect(err.message).toContain("no model here");
  });

  it("stops at once when aborted, and tells the engine, so it can stop too", async () => {
    const tts = await start();
    const controller = new AbortController();
    let seen = 0;
    for await (const _ of tts.synthesize({ text: "forever", signal: controller.signal })) {
      if (++seen === 3) controller.abort();
    }
    expect(seen).toBe(3);
    // the engine itself was told to stop (it counts the stops it saw)
    await expect
      .poll(async () => (await collect(tts.synthesize({ text: "stats" })))[0]!.samples[0], { timeout: 3000 })
      .toBe(1);
  });

  it("says nothing for a request that was already aborted, and does not start the engine on it", async () => {
    const tts = await start();
    const controller = new AbortController();
    controller.abort();
    expect(await collect(tts.synthesize({ text: "forever", signal: controller.signal }))).toEqual([]);
    await new Promise((r) => setTimeout(r, 100));
    expect((await collect(tts.synthesize({ text: "stats" })))[0]!.samples[1]).toBe(0); // nothing left running
  });

  it("fails the request that was in flight if the worker dies, as a TtsError", async () => {
    const tts = await start();
    const err = await collect(tts.synthesize({ text: "die" })).catch((e) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect(err.message).toMatch(/stopped/);
  });

  it("lets work in progress finish before it shuts the worker down (stopping a native engine mid-run can crash the process)", async () => {
    const flag = new SharedArrayBuffer(4);
    const tts = await start({ flag });
    const controller = new AbortController();
    const running = collect(tts.synthesize({ text: "slow:300", signal: controller.signal }));
    await new Promise((r) => setTimeout(r, 50)); // it is under way
    controller.abort(); // nobody wants the result any more, but the engine cannot stop part-way
    await running;
    await tts.close();
    expect(Atomics.load(new Int32Array(flag), 0)).toBe(1); // it was allowed to finish
  });

  it("does not wait forever for work that never ends", async () => {
    const tts = await WorkerTts.create({ module, options: {}, closeWaitMs: 200 });
    const controller = new AbortController();
    void collect(tts.synthesize({ text: "slow:60000", signal: controller.signal })).catch(() => {});
    controller.abort();
    const started = Date.now();
    await tts.close();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("leaves the main thread free while it works", async () => {
    const tts = await start();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    await collect(tts.synthesize({ text: "chunks:3" }));
    await new Promise((r) => setTimeout(r, 100));
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(5);
  });
});
