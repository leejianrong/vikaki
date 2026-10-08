import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";
import { startServer, type RunningServer } from "@vikaki/server";
import { FakeTts, type FakeTtsOptions } from "@vikaki/tts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

type Msg = Record<string, unknown> & { type: string; utterance_id?: string };

/** A driver connection that timestamps everything the hub tells it. */
class Driver {
  readonly events: { at: number; msg: Msg }[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => this.events.push({ at: Date.now(), msg: JSON.parse(d.toString()) }));
  }
  static async connect(url: string): Promise<Driver> {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
    ws.send(JSON.stringify(make("hello", { role: "driver" })));
    const d = new Driver(ws);
    await d.waitFor((m) => m.type === "welcome");
    return d;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  say(text: string, id = "u1", extra: Record<string, unknown> = {}) {
    this.send({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: id, text, ...extra });
  }
  cancel(id = "u1") {
    this.send(make("cancel", { utterance_id: id }));
  }
  /** When a message matching `pred` arrived (waiting for it if needed). */
  async waitFor(pred: (m: Msg) => boolean, ms = 15_000): Promise<number> {
    const end = Date.now() + ms;
    for (;;) {
      const hit = this.events.find((e) => pred(e.msg));
      if (hit) return hit.at;
      if (Date.now() > end) throw new Error(`timed out; saw ${this.events.map((e) => e.msg.type).join(",")}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  count(pred: (m: Msg) => boolean) {
    return this.events.filter((e) => pred(e.msg)).length;
  }
}

/** Highest and lowest mouth weight on the page over `ms`. */
const mouth = (page: Page, ms: number) =>
  page.evaluate(async (t) => {
    let min = Infinity, max = 0;
    const end = performance.now() + t;
    while (performance.now() < end) {
      const v = Math.max(0, ...Object.values(window.__vikaki!.visemes));
      min = Math.min(min, v);
      max = Math.max(max, v);
      await new Promise((r) => setTimeout(r, 25));
    }
    return { min, max };
  }, ms);

/**
 * Millisecond budgets measure the machine as much as the code. CI runs on 2 shared cores with software
 * WebGL, where a cancel can take over a second to reach the page (reproduced locally by pinning to 2
 * cores). The budgets are enforced on a normal machine; everything else is checked everywhere.
 */
const STRICT_TIMING = !process.env.CI;

let browser: Browser;
let server: RunningServer | undefined;
const opened: Driver[] = [];
const pages: Page[] = [];

beforeAll(async () => {
  browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  for (const d of opened.splice(0)) d.ws.terminate();
  await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {})));
  await server?.close();
  server = undefined;
});

async function setup(tts: FakeTtsOptions = {}, pageCount = 1) {
  const fake = new FakeTts({ sampleRate: 16000, msPerChar: 50, chunkMs: 100, ...tts });
  server = await startServer({ staticDir, speech: { tts: fake } });
  const viewers: Page[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    pages.push(page);
    await page.goto(`${server.url}?live=1&timeline=1&hud=0&seed=3`);
    await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.live.soundBlocked === false, null, { timeout: 30_000 });
    // Note every time the page goes without running a timer for a while, on the timeline's clock: software WebGL can freeze it for
    // most of a second at the first speech, and audio scheduled during a freeze lands late. Tests use it to tell that from a bug.
    await page.evaluate(() => {
      const g = window as unknown as { __freezes: [number, number][] };
      g.__freezes = [];
      let last = performance.now();
      window.setInterval(() => {
        const n = performance.now();
        if (n - last > 60) g.__freezes.push([(window.__vikaki!.timeline as { now(): number }).now(), n - last]);
        last = n;
      }, 20);
    });
    viewers.push(page);
  }
  const driver = await Driver.connect(server.wsUrl);
  opened.push(driver);
  return { fake, driver, page: viewers[0]!, viewers };
}

const started = (id = "u1") => (m: Msg) => m.type === "speech_started" && m.utterance_id === id;
const finished = (id = "u1") => (m: Msg) => m.type === "speech_finished" && m.utterance_id === id;
const interrupted = (id = "u1") => (m: Msg) => m.type === "speech_interrupted" && m.utterance_id === id;

describe("speech, from driver to avatar and back", () => {
  it("speaks a line: the mouth moves while it plays, and the driver hears when it starts and ends", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const { driver, page } = await setup();
    const sampling = mouth(page, 4500);
    driver.say("x".repeat(40)); // 2.0 s
    const t1 = await driver.waitFor(started());
    const t2 = await driver.waitFor(finished());
    expect(t2 - t1).toBeGreaterThan(1700);
    if (STRICT_TIMING) expect(t2 - t1).toBeLessThan(3200); // a millisecond budget: normal machines only
    const { min, max } = await sampling;
    expect(max).toBeGreaterThan(0.3); // the mouth opened for the speech
    expect(min).toBeLessThan(0.05); // and was closed before and after it
    expect(await page.evaluate(() => window.__vikaki!.live!.events)).toEqual(["started:u1", "finished:u1"]);
  });

  it("reports its own time to first audio and first mouth frame with speech_finished", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const { driver } = await setup();
    driver.say("x".repeat(20)); // 1.0 s
    await driver.waitFor(finished());
    const done = driver.events.find((e) => finished()(e.msg))!.msg as { timing?: { audio_ms: number; frame_ms?: number } };
    // Reported, not gated: only that they exist and are in order (the mouth cannot open before the sound is heard).
    expect(done.timing?.audio_ms).toBeGreaterThan(0);
    expect(done.timing?.frame_ms).toBeGreaterThanOrEqual(done.timing!.audio_ms);
  });

  it("shows each of the seven emotions a line asks for, scaled by its intensity, and relaxes after it", { timeout: 150_000 }, async () => {
    const { driver, page } = await setup({ msPerChar: 60 });
    // What the preset says at full strength, read from the page's own model so the test follows the presets.
    const want = (e: string, k: number) =>
      page.evaluate(([name, i]) => window.__vikaki!.presetPose!(name as string, i as number), [e, k] as const);
    let n = 0;
    for (const emotion of ["neutral", "happy", "smug", "worried", "surprised", "sad", "angry"]) {
      const id = `e${++n}`;
      driver.say("x".repeat(30), id, { emotion, intensity: n % 2 === 0 ? 1 : 0.6 }); // 1.8 s
      const at = await driver.waitFor(started(id), 40_000); // patient: no millisecond budget here, and CI is slow
      await page.waitForTimeout(Math.max(0, 1000 - (Date.now() - at))); // one second after the avatar began
      const shown = await page.evaluate(() => window.__vikaki!.emotionPose!);
      const expected = (await want(emotion, n % 2 === 0 ? 1 : 0.6)) as typeof shown;
      for (const k of ["squint", "pitch", "roll", "shake", "bob"] as const) expect(Math.abs(shown[k] - expected[k]), `${emotion} ${k}`).toBeLessThan(0.05);
      expect(shown.symbol, emotion).toBe(expected.symbol);
      expect(Math.abs(shown.symbolAmount - expected.symbolAmount)).toBeLessThan(0.05);
      await driver.waitFor(finished(id), 40_000);
    }
    // After the last line the face relaxes to neutral.
    await page.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === null && window.__vikaki!.emotionPose!.squint < 0.02, null, { timeout: 8000 });
  });

  it("looks thoughtful between turn_started and turn_ended, and a line that starts ends it", { timeout: 60_000 }, async () => {
    const { driver, page } = await setup();
    const pose = () => page.evaluate(() => window.__vikaki!.emotionPose!);
    driver.send(make("turn_started", { seat_id: "seat-1" }));
    await page.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === "dots" && window.__vikaki!.emotionPose!.symbolAmount > 0.95 && Math.abs(window.__vikaki!.emotionPose!.roll) > 0.09, null, { timeout: 15_000 }); // dots up and the head tipped
    driver.send(make("turn_ended", { seat_id: "seat-1" }));
    await page.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === null && Math.abs(window.__vikaki!.emotionPose!.roll) < 0.02, null, { timeout: 15_000 });

    // A line that begins during the turn replaces the thinking with its own feeling.
    driver.send(make("turn_started", { seat_id: "seat-1" }));
    await page.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === "dots", null, { timeout: 15_000 });
    driver.say("x".repeat(30), "u1", { emotion: "happy" });
    await driver.waitFor(started(), 40_000);
    await page.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === "sparkle", null, { timeout: 15_000 });
    driver.send(make("turn_ended", { seat_id: "seat-1" })); // arrives late, mid-line: must not take the sparkles away
    await page.waitForTimeout(500);
    expect((await pose()).symbol).toBe("sparkle");
    await driver.waitFor(finished(), 40_000);
  });

  it("treats an unknown emotion as neutral, without an error", async () => {
    const { driver, page } = await setup();
    driver.say("x".repeat(30), "u1", { emotion: "blorp" });
    await driver.waitFor(started());
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__vikaki!.emotionPose!.symbol)).toBeNull();
    expect(driver.count((m) => m.type === "error")).toBe(0);
    await driver.waitFor(finished());
  });

  it("closes the mouth again once the speech has ended", async () => {
    const { driver, page } = await setup();
    driver.say("x".repeat(10)); // 0.5 s
    await driver.waitFor(finished());
    // It must close (a mouth stuck open is the bug this guards). How fast is a timing budget, not checked here.
    await page.waitForFunction(() => Math.max(0, ...Object.values(window.__vikaki!.visemes)) < 0.05, null, { timeout: 10_000 });
    expect((await mouth(page, 600)).max).toBeLessThan(0.05); // and stays shut
  }, 60_000);

  it("stops quickly when cancelled mid-speech, and the next line plays normally", async () => {
    const { driver, page } = await setup();
    driver.say("x".repeat(80), "long"); // 4 s
    await driver.waitFor(started("long"));
    await page.waitForTimeout(500);
    const sentAt = Date.now();
    driver.cancel("long");
    const at = await driver.waitFor(interrupted("long"), 3000);
    if (STRICT_TIMING) expect(at - sentAt).toBeLessThan(400);
    expect(driver.count(finished("long"))).toBe(0);
    // The mouth shuts at once when speech is cut off. Without that, the lip-sync node's own smoothing
    // takes about 190 ms to close it, so 100 ms after the interruption is reported it would still be open.
    if (STRICT_TIMING) {
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => Math.max(0, ...Object.values(window.__vikaki!.visemes)))).toBeLessThan(0.05);
    } else {
      await page.waitForFunction(() => Math.max(0, ...Object.values(window.__vikaki!.visemes)) < 0.05, null, { timeout: 5000 });
    }
    expect((await mouth(page, 500)).max).toBeLessThan(0.05); // and stays shut
    driver.say("x".repeat(10), "next");
    await driver.waitFor(finished("next"));
  }, 60_000);

  it("starts speaking a streamed line before the end of it has been written", async () => {
    const { driver } = await setup();
    const send = (delta: string, final?: boolean) =>
      driver.send({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: "u1", delta, ...(final ? { final } : {}) });
    send("The first sentence is done. And");
    send(" the second is still being");
    await driver.waitFor(started());
    expect(driver.count(finished())).toBe(0); // the line is not complete yet
    send(" written now.", true);
    await driver.waitFor(finished());
  }, 60_000);

  it("opens the mouth only between speech_started and speech_finished for a line sent as three deltas", async () => {
    const { driver, page } = await setup();
    // Sample the mouth with wall-clock times, to line up against when the driver was told.
    const sampling = page.evaluate(async (ms) => {
      const out: [number, number][] = [];
      const end = Date.now() + ms;
      while (Date.now() < end) {
        out.push([Date.now(), Math.max(0, ...Object.values(window.__vikaki!.visemes))]);
        await new Promise((r) => setTimeout(r, 20));
      }
      return out;
    }, 5000);
    await page.waitForTimeout(300); // some samples from before anything is said
    const send = (delta: string, final?: boolean) =>
      driver.send({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: "u1", delta, ...(final ? { final } : {}) });
    send("The first sentence is a long one. ");
    send("And the second follows it. ");
    send("Then it ends.", true);
    const startedAt = await driver.waitFor(started());
    const finishedAt = await driver.waitFor(finished());
    const samples = await sampling;
    const open = (from: number, to: number) => samples.filter(([t]) => t >= from && t <= to).map(([, v]) => v);
    // Margins cover the hop from page to driver and the mouth's own smoothing (about 200 ms); they are not a timing budget.
    expect(Math.max(...open(0, startedAt - 100))).toBeLessThan(0.05);
    expect(Math.max(...open(startedAt, finishedAt))).toBeGreaterThan(0.3);
    expect(Math.max(...open(finishedAt + 800, Infinity), 0)).toBeLessThan(0.05);
  }, 60_000);

  it("reports a speech failure to the driver and carries on", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const { driver } = await setup({ failOn: "boom" });
    driver.say("this will boom", "bad");
    await driver.waitFor((m) => m.type === "error" && m.code === "tts_failed" && m.utterance_id === "bad");
    driver.say("all fine", "good");
    await driver.waitFor(finished("good"));
  });

  it("tells the driver once when two avatar pages are watching", async () => {
    const { driver, viewers } = await setup({}, 2);
    driver.say("x".repeat(10));
    await driver.waitFor(finished());
    // Each page plays and reports on its own clock, so wait for both rather than for a fixed time.
    for (const p of viewers) {
      await p.waitForFunction(() => window.__vikaki!.live!.events.includes("finished:u1"), null, { timeout: 5000 });
      expect(await p.evaluate(() => window.__vikaki!.live!.events)).toEqual(["started:u1", "finished:u1"]);
    }
    await new Promise((r) => setTimeout(r, 200)); // any duplicate report would have reached the driver by now
    expect(driver.count(started())).toBe(1);
    expect(driver.count(finished())).toBe(1);
  }, 90_000);
});

type Recorded = {
  frames: number[][];
  events: { t: number; kind: string; utteranceId?: string }[];
  utterances: { id: string; startMs: number; endMs: number; interruptedAtMs?: number; pieces: { index: number; text: string; startMs: number; endMs: number }[] }[];
};
/** How long the page was frozen (ms) during `[fromMs, toMs]` on the timeline's clock. */
const frozenDuring = async (page: Page, fromMs: number, toMs: number) => {
  const freezes = await page.evaluate(() => (window as unknown as { __freezes: [number, number][] }).__freezes);
  return freezes.filter(([end, length]) => end - length < toMs && end > fromMs).reduce((sum, [, length]) => sum + length, 0);
};
const recorded = (page: Page) => page.evaluate(() => (window.__vikaki!.timeline as { toJSON(): unknown }).toJSON()) as Promise<Recorded>;

describe("the page's timeline of what happened", () => {
  it("records each spoken sentence with its text and when it was heard, with the mouth moving inside it", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const { driver, page } = await setup();
    driver.say("Hello there. How are you?", "u1");
    await driver.waitFor(finished());
    const t = await recorded(page);

    const u = t.utterances.find((x) => x.id === "u1")!;
    expect(u.pieces.map((p) => p.text)).toEqual(["Hello there.", "How are you?"]);
    const [a, b] = u.pieces as [typeof u.pieces[0], typeof u.pieces[0]];
    expect(a.endMs - a.startMs).toBeGreaterThan(400); // 12 characters at 50 ms each
    // The second sentence follows the first with no gap, unless the page was frozen while it should have been scheduled.
    const frozen = await frozenDuring(page, a.endMs - 1000, b.startMs);
    expect(Math.abs(b.startMs - a.endMs), `a gap of ${Math.round(b.startMs - a.endMs)} ms with the page frozen for ${Math.round(frozen)} ms around it`).toBeLessThan(60 + frozen);

    // the page's own events, in order, and the first one lands where the audio was scheduled to begin
    const kinds = t.events.filter((e) => e.utteranceId === "u1").map((e) => e.kind);
    expect(kinds.indexOf("started")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("started")).toBeLessThan(kinds.indexOf("finished"));
    const startedAt = t.events.find((e) => e.kind === "started")!.t;
    expect(Math.abs(startedAt - a.startMs)).toBeLessThan(STRICT_TIMING ? 250 : 1500);

    // frame layout: [t, 5 commanded, 5 applied, volume, blink]. The mouth opens inside the sentence and is shut well after it.
    const inside = t.frames.filter((f) => f[0]! >= a.startMs + 100 && f[0]! <= a.endMs);
    expect(Math.max(...inside.map((f) => f[1]!))).toBeGreaterThan(0.3);
    const after = t.frames.filter((f) => f[0]! > u.endMs + 800);
    if (after.length > 0) expect(Math.max(...after.map((f) => f[1]!))).toBeLessThan(0.05);
    // what was displayed follows what was commanded
    expect(Math.max(...t.frames.map((f) => Math.max(...[0, 1, 2, 3, 4].map((i) => Math.abs(f[1 + i]! - f[6 + i]!)))))).toBeLessThan(0.02);
  });

  it("clips an interrupted utterance at the moment it was cut", async () => {
    const { driver, page } = await setup({ msPerChar: 100 });
    driver.say("This is a long sentence that will be cut off part way through. And another one after it.", "u1");
    await driver.waitFor(started());
    await page.waitForFunction(() => (window.__vikaki!.timeline as { events(): { kind: string }[] }).events().some((e) => e.kind === "started"));
    driver.cancel("u1");
    await driver.waitFor(interrupted());
    await page.waitForFunction(() => (window.__vikaki!.timeline as { events(): { kind: string }[] }).events().some((e) => e.kind === "interrupted"));
    const u = (await recorded(page)).utterances.find((x) => x.id === "u1")!;
    expect(u.interruptedAtMs).toBeDefined();
    expect(u.endMs).toBeLessThanOrEqual(u.interruptedAtMs!);
    for (const p of u.pieces) expect(p.endMs).toBeLessThanOrEqual(u.interruptedAtMs!);
  }, 60_000);
});
