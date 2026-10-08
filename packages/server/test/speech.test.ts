import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodePcm16, make, PROTOCOL_VERSION } from "@vikaki/protocol";
import { FakeTts, type FakeTtsOptions } from "@vikaki/tts";
import { startServer, type RunningServer, type SpeechOptions, type SpeechTiming } from "../src/server.ts";
import { Client, until, utterance } from "./helpers.ts";

type Msg = Record<string, unknown>;

let dir: string;
let server: RunningServer | undefined;
const clients: Client[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-speech-"));
  await writeFile(join(dir, "index.html"), "hi");
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await server?.close();
  server = undefined;
});

/** Start a server with a fake voice, a driver, and `viewers` avatar pages. Returns a log per client. */
async function setup(opts: { tts?: FakeTtsOptions; viewers?: number; speech?: Partial<SpeechOptions> } = {}) {
  const fake = new FakeTts({ sampleRate: 16000, msPerChar: 50, chunkMs: 100, ...opts.tts });
  server = await startServer({ staticDir: dir, speech: { tts: fake, ...opts.speech } });
  const viewers: Client[] = [];
  for (let i = 0; i < (opts.viewers ?? 1); i++) {
    const v = await Client.join(server.wsUrl, "viewer");
    clients.push(v);
    await v.next();
    viewers.push(v);
  }
  const driver = await Client.join(server.wsUrl, "driver");
  clients.push(driver);
  await driver.next();
  return { fake, viewers, driver, viewer: viewers[0]! };
}

/** Read messages until `stop` says the last one read ends the wait. */
async function readUntil(c: Client, stop: (m: Msg) => boolean, ms = 4000): Promise<Msg[]> {
  const out: Msg[] = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const m = await c.next();
    out.push(m);
    if (stop(m)) return out;
  }
  throw new Error(`timed out; got ${out.map((m) => m.type).join(",")}`);
}
const isFinal = (m: Msg) => m.type === "audio" && m.final === true;
const audioOf = (msgs: Msg[], id?: string) => msgs.filter((m) => m.type === "audio" && (id === undefined || m.utterance_id === id));
const seconds = (msgs: Msg[]) => msgs.reduce((s, m) => s + decodePcm16(String(m.pcm)).length / Number(m.sample_rate), 0);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const x = (n: number) => "x".repeat(n);

describe("welcome", () => {
  it("tells clients which speech engine is in use", async () => {
    const { driver, viewer } = await setup();
    // setup() already consumed each welcome; join fresh clients to read it.
    const c = await Client.join(server!.wsUrl, "viewer");
    clients.push(c);
    expect(await c.next()).toMatchObject({ type: "welcome", speech: "fake" });
    void driver;
    void viewer;
  });

  it("says the speech is off when there is no engine", async () => {
    server = await startServer({ staticDir: dir });
    const c = await Client.join(server.wsUrl, "driver");
    clients.push(c);
    expect(await c.next()).toMatchObject({ type: "welcome", speech: "off" });
  });
});

describe("speaking to avatar pages", () => {
  it("relays the line, then audio in order, then a final marker", async () => {
    const { viewer, driver } = await setup();
    driver.send(utterance({ text: x(40) })); // 2.0 s at 50 ms per character
    const msgs = await readUntil(viewer, isFinal);
    expect(msgs[0]).toMatchObject({ type: "utterance", utterance_id: "u1" });
    const audio = audioOf(msgs);
    expect(audio.map((m) => m.seq)).toEqual(Array.from({ length: audio.length }, (_, i) => i));
    expect(audio.at(-1)).toMatchObject({ final: true, pcm: "" });
    expect(audio.slice(0, -1).every((m) => m.final === false && m.sample_rate === 16000)).toBe(true);
    expect(seconds(audio)).toBeCloseTo(2, 1);
  });

  it("speaks each sentence as its own piece, in order", async () => {
    const { viewer, driver, fake } = await setup();
    driver.send(utterance({ text: "One. Two. Three." }));
    await readUntil(viewer, isFinal);
    expect(fake.requests).toEqual(["One.", "Two.", "Three."]);
  });

  it("sends long audio in slices no longer than the limit", async () => {
    const { viewer, driver } = await setup({ tts: { chunkMs: 5000 }, speech: { maxSliceSeconds: 1 } });
    driver.send(utterance({ text: x(100) })); // 5 s in one engine chunk
    const audio = audioOf(await readUntil(viewer, isFinal)).slice(0, -1);
    expect(audio.length).toBe(5);
    expect(audio.every((m) => decodePcm16(String(m.pcm)).length <= 16000)).toBe(true);
  });

  it("starts speaking a streamed line before it is finished, and ends it on `final`", async () => {
    const { viewer, driver, fake } = await setup();
    driver.send(utterance({ text: undefined, delta: "Hello there." }));
    await wait(200);
    expect(fake.requests).toEqual([]); // the sentence end is not certain yet
    driver.send(utterance({ text: undefined, delta: " How are you" }));
    await until(() => fake.requests.length === 1, 2000, "first sentence");
    expect(fake.requests).toEqual(["Hello there."]);
    const early = await readUntil(viewer, (m) => m.type === "audio" && m.seq === 0);
    expect(early.some(isFinal)).toBe(false);
    driver.send(utterance({ text: undefined, delta: " today", final: true }));
    const rest = await readUntil(viewer, isFinal);
    expect(fake.requests).toEqual(["Hello there.", "How are you today"]);
    expect(rest.at(-1)).toMatchObject({ final: true });
  });

  it("speaks queued utterances one after another, restarting seq for each", async () => {
    const { viewer, driver } = await setup();
    driver.send(utterance({ utterance_id: "a", text: x(10) }));
    driver.send(utterance({ utterance_id: "b", text: x(10) }));
    const msgs = (await readUntil(viewer, (m) => isFinal(m) && m.utterance_id === "b")).filter((m) => m.type === "audio");
    const ids = msgs.map((m) => m.utterance_id);
    expect(ids).toEqual([...ids].sort()); // all of a, then all of b
    expect(audioOf(msgs, "b")[0]).toMatchObject({ seq: 0 });
    expect(audioOf(msgs, "a").findIndex(isFinal)).toBe(audioOf(msgs, "a").length - 1);
  });

  it("passes the persona as the voice, or whatever voiceFor says", async () => {
    const a = await setup();
    a.driver.send(utterance({ text: "hi", persona: "ada" }));
    await readUntil(a.viewer, isFinal);
    expect(a.fake.voices).toEqual(["ada"]);
    await server!.close();
    server = undefined;
    clients.splice(0).forEach((c) => c.ws.terminate());
    const b = await setup({ speech: { voiceFor: (p) => (p === "ada" ? "af_heart" : undefined) } });
    b.driver.send(utterance({ text: "hi", persona: "ada" }));
    await readUntil(b.viewer, isFinal);
    expect(b.fake.voices).toEqual(["af_heart"]);
  });

  it("measures the time from text to first audio", async () => {
    const timings: SpeechTiming[] = [];
    const { viewer, driver } = await setup({ tts: { firstChunkDelayMs: 150 }, speech: { onTiming: (t) => timings.push(t) } });
    driver.send(utterance({ text: "Hello." }));
    await readUntil(viewer, isFinal);
    expect(timings).toHaveLength(1);
    expect(timings[0]!.utterance_id).toBe("u1");
    expect(timings[0]!.firstAudioAt - timings[0]!.textAt).toBeGreaterThanOrEqual(140);
    expect(timings[0]!.firstAudioAt - timings[0]!.textAt).toBeLessThan(1000);
  });
});

describe("a later session", () => {
  it("can reuse an utterance id that an earlier, finished session used", async () => {
    const { viewer, driver } = await setup();
    driver.send(utterance({ utterance_id: "demo-1", text: "Hello there." }));
    await readUntil(viewer, isFinal);
    driver.ws.close();
    viewer.ws.close();
    await until(() => server!.hub.viewerCount === 0, 3000, "the first session to leave");
    const viewer2 = await Client.join(server!.wsUrl, "viewer");
    clients.push(viewer2);
    await viewer2.next();
    const driver2 = await Client.join(server!.wsUrl, "driver");
    clients.push(driver2);
    await driver2.next();
    driver2.send(utterance({ utterance_id: "demo-1", text: "Hello again." }));
    const seen = await readUntil(viewer2, isFinal);
    expect(audioOf(seen, "demo-1").length).toBeGreaterThan(1);
  });
});

describe("which sentence a slice belongs to", () => {
  it("numbers the slices by spoken piece, and sends each piece's text once, on its first slice", async () => {
    const { viewer, driver } = await setup({ tts: { msPerChar: 100, chunkMs: 100 } });
    driver.send(utterance({ utterance_id: "s", text: "Hello there. How are you?" }));
    const seen = await readUntil(viewer, isFinal);
    const slices = audioOf(seen).filter((m) => m.final === false);
    expect(slices.map((m) => m.sentence_index)).toEqual(slices.map((_, i) => (i < slices.findIndex((m) => m.sentence_index === 1) ? 0 : 1)));
    expect(slices.filter((m) => m.sentence_text !== undefined).map((m) => [m.sentence_index, m.sentence_text])).toEqual([
      [0, "Hello there."],
      [1, "How are you?"],
    ]);
    expect(slices.length).toBeGreaterThan(2); // each sentence takes several slices, so "once" means something
    const end = seen.at(-1)!;
    expect(end.sentence_index).toBeUndefined();
    expect(end.sentence_text).toBeUndefined();
  });
});

describe("cancelling", () => {
  it("stops an utterance before any audio is made, tells the viewers, and carries on with the next", async () => {
    const { viewer, driver, fake } = await setup({ tts: { firstChunkDelayMs: 400 } });
    driver.send(utterance({ utterance_id: "a", text: x(20) }));
    await wait(100);
    driver.send(make("cancel", { utterance_id: "a" }));
    const seen = await readUntil(viewer, (m) => m.type === "cancel");
    expect(audioOf(seen)).toEqual([]);
    expect(seen.at(-1)).toMatchObject({ type: "cancel", utterance_id: "a" });
    await wait(600);
    expect(viewer.inbox.filter((m) => m.type === "audio")).toEqual([]); // never any audio for a
    driver.send(utterance({ utterance_id: "b", text: "Hi." }));
    const next = await readUntil(viewer, (m) => isFinal(m) && m.utterance_id === "b");
    expect(audioOf(next, "b").length).toBeGreaterThan(1);
    expect(fake.requests).toEqual(["xxxxxxxxxxxxxxxxxxxx", "Hi."]); // a was started, then abandoned
  });

  it("frees the queue at once: the next utterance starts without waiting out the cancelled one", async () => {
    const { driver, fake } = await setup({ tts: { firstChunkDelayMs: 600 } });
    driver.send(utterance({ utterance_id: "a", text: "Slow to start." }));
    driver.send(utterance({ utterance_id: "b", text: "Next." }));
    await wait(100);
    const t0 = Date.now();
    driver.send(make("cancel", { utterance_id: "a" }));
    await until(() => fake.requests.includes("Next."), 2000, "the next utterance to start");
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("drops an utterance that is still queued, without ever synthesizing it", async () => {
    const { viewer, driver, fake } = await setup({ tts: { firstChunkDelayMs: 300 } });
    driver.send(utterance({ utterance_id: "a", text: "First." }));
    driver.send(utterance({ utterance_id: "b", text: "Second." }));
    await wait(50);
    driver.send(make("cancel", { utterance_id: "b" }));
    await readUntil(viewer, (m) => isFinal(m) && m.utterance_id === "a");
    await wait(500);
    expect(fake.requests).toEqual(["First."]);
  });

  it("ignores more text for an utterance that was cancelled, with no error", async () => {
    const { driver, fake } = await setup({ tts: { firstChunkDelayMs: 200 } });
    driver.send(utterance({ text: undefined, delta: "Starting a long answer. " }));
    await wait(50);
    driver.send(make("cancel", { utterance_id: "u1" }));
    driver.send(utterance({ text: undefined, delta: "More that nobody wants. ", final: true }));
    await wait(500);
    expect(driver.inbox).toEqual([]);
    expect(fake.requests.join(" ")).not.toContain("nobody wants");
  });

  it("stops everything when the driver disconnects, and tells the viewers", async () => {
    const { viewer, driver, fake } = await setup({ tts: { firstChunkDelayMs: 300 } });
    driver.send(utterance({ utterance_id: "a", text: "Long one." }));
    driver.send(utterance({ utterance_id: "b", text: "Queued." }));
    await wait(80);
    driver.close();
    const seen = await readUntil(viewer, (m) => m.type === "cancel" && m.utterance_id === "a");
    expect(seen.at(-1)).toMatchObject({ type: "cancel", utterance_id: "a" });
    await wait(500);
    expect(viewer.inbox.some((m) => m.type === "audio")).toBe(false);
    expect(fake.requests).toEqual(["Long one."]);
  });
});

describe("when speech fails", () => {
  it("reports tts_failed to the driver, cancels the viewers, and keeps working", async () => {
    const { viewer, driver } = await setup({ tts: { failOn: "boom" } });
    driver.send(utterance({ utterance_id: "bad", text: "this will boom" }));
    expect(await driver.next()).toMatchObject({ type: "error", code: "tts_failed", utterance_id: "bad" });
    const seen = await readUntil(viewer, (m) => m.type === "cancel");
    expect(seen.at(-1)).toMatchObject({ utterance_id: "bad" });
    driver.send(utterance({ utterance_id: "good", text: "all fine" }));
    const next = await readUntil(viewer, (m) => isFinal(m) && m.utterance_id === "good");
    expect(audioOf(next, "good").length).toBeGreaterThan(1);
  });

  it("does not let a failed piece leave the rest of its utterance behind", async () => {
    const { viewer, driver, fake } = await setup({ tts: { failOn: "boom" } });
    driver.send(utterance({ utterance_id: "bad", text: "Fine. Then boom. After that." }));
    expect(await driver.next()).toMatchObject({ type: "error", code: "tts_failed" });
    await wait(300);
    expect(fake.requests).toEqual(["Fine.", "Then boom."]);
    expect(viewer.inbox.some((m) => isFinal(m) && m.utterance_id === "bad")).toBe(false);
  });

  it("rejects a second utterance with an id that is still being spoken", async () => {
    const { driver } = await setup({ tts: { firstChunkDelayMs: 300 } });
    driver.send(utterance({ text: "One." }));
    driver.send(utterance({ text: "Again." }));
    expect(await driver.next()).toMatchObject({ type: "error", code: "bad_message" });
  });
});

describe("with no avatar page connected", () => {
  it("plays the speech in real time and tells the driver when it starts and ends", async () => {
    const { driver } = await setup({ viewers: 0 });
    const t0 = Date.now();
    driver.send(utterance({ text: x(10) })); // 0.5 s
    expect(await driver.next()).toMatchObject({ type: "speech_started", utterance_id: "u1", seat_id: "seat-1" });
    const started = Date.now() - t0;
    expect(started).toBeLessThan(400);
    expect(await driver.next()).toMatchObject({ type: "speech_finished", utterance_id: "u1" });
    const total = Date.now() - t0;
    expect(total).toBeGreaterThanOrEqual(450);
    expect(total).toBeLessThan(1500);
  });

  it("reports an interruption when cancelled mid-speech, and never a finish", async () => {
    const { driver } = await setup({ viewers: 0 });
    driver.send(utterance({ text: x(40) })); // 2 s
    expect(await driver.next()).toMatchObject({ type: "speech_started" });
    await wait(150);
    const t0 = Date.now();
    driver.send(make("cancel", { utterance_id: "u1" }));
    expect(await driver.next()).toMatchObject({ type: "speech_interrupted", utterance_id: "u1", reason: "cancelled" });
    expect(Date.now() - t0).toBeLessThan(300);
    await wait(300);
    expect(driver.inbox).toEqual([]);
  });

  it("moves on to the next utterance as soon as a simulated one is cancelled", async () => {
    const { driver } = await setup({ viewers: 0 });
    driver.send(utterance({ utterance_id: "a", text: x(40) })); // 2 s
    driver.send(utterance({ utterance_id: "b", text: x(10) }));
    expect(await driver.next()).toMatchObject({ type: "speech_started", utterance_id: "a" });
    await wait(150);
    const t0 = Date.now();
    driver.send(make("cancel", { utterance_id: "a" }));
    expect(await driver.next()).toMatchObject({ type: "speech_interrupted", utterance_id: "a" });
    expect(await driver.next()).toMatchObject({ type: "speech_started", utterance_id: "b" });
    expect(Date.now() - t0).toBeLessThan(400); // not the 1.85 s left of a
  });

  it("speaks one utterance at a time: the second starts after the first finishes", async () => {
    const { driver } = await setup({ viewers: 0 });
    driver.send(utterance({ utterance_id: "a", text: x(10) }));
    driver.send(utterance({ utterance_id: "b", text: x(10) }));
    const seen = (await Promise.all([1, 2, 3, 4].map(() => driver.next()))).map((m) => `${m.type}:${m.utterance_id}`);
    expect(seen).toEqual(["speech_started:a", "speech_finished:a", "speech_started:b", "speech_finished:b"]);
  });

  it("treats empty text as spoken at once, without calling the engine", async () => {
    const { driver, fake } = await setup({ viewers: 0 });
    driver.send(utterance({ text: "   " }));
    expect(await driver.next()).toMatchObject({ type: "speech_started" });
    expect(await driver.next()).toMatchObject({ type: "speech_finished" });
    expect(fake.requests).toEqual([]);
  });
});

describe("streams that never finish", () => {
  it("finishes a streamed line that goes quiet", async () => {
    const { viewer, driver, fake } = await setup({ speech: { idleFlushMs: 150 } });
    driver.send(utterance({ text: undefined, delta: "Half a thought" }));
    const seen = await readUntil(viewer, isFinal);
    expect(fake.requests).toEqual(["Half a thought"]);
    expect(seen.at(-1)).toMatchObject({ final: true });
  });
});

describe("who may send audio", () => {
  it("is nobody but the hub", async () => {
    const { viewer, driver } = await setup();
    const audio = { protocol_version: PROTOCOL_VERSION, type: "audio", utterance_id: "u1", seq: 0, sample_rate: 16000, pcm: "AAA=", final: false };
    driver.send(audio);
    expect(await driver.next()).toMatchObject({ type: "error", code: "not_allowed" });
    viewer.send(audio);
    expect(await viewer.next()).toMatchObject({ type: "error", code: "not_allowed" });
  });
});
