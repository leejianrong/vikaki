import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const avatars = fileURLToPath(new URL("../../engine/public/avatars/", import.meta.url));

type Msg = Record<string, unknown> & { type: string; utterance_id?: string };

class Driver {
  readonly events: Msg[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => this.events.push(JSON.parse(d.toString())));
  }
  static async connect(url: string): Promise<Driver> {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
    ws.send(JSON.stringify(make("hello", { role: "driver" })));
    const d = new Driver(ws);
    await d.waitFor((m) => m.type === "welcome");
    return d;
  }
  say(text: string, id: string, persona?: string) {
    this.ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: id, text, ...(persona ? { persona } : {}) }));
  }
  async waitFor(pred: (m: Msg) => boolean, ms = 40_000): Promise<Msg> {
    const end = Date.now() + ms;
    for (;;) {
      const hit = this.events.find(pred);
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`timed out; saw ${this.events.map((e) => e.type).join(",")}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

let browser: Browser;
let server: RunningServer | undefined;
const pages: Page[] = [];
const drivers: Driver[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  for (const d of drivers.splice(0)) d.ws.terminate();
  await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {})));
  await server?.close();
  server = undefined;
});

const connected = (page: Page) => page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.live.soundBlocked === false, null, { timeout: 30_000 });

/** An audio-only page that records what it fetched and whether it ever asked for a WebGL context. */
async function openAudioOnly(query: string) {
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  pages.push(page);
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await page.addInitScript(() => {
    const w = window as unknown as { __gl: number };
    w.__gl = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (/webgl/.test(kind)) w.__gl++;
      return (original as (...a: unknown[]) => unknown).call(this, kind, ...rest) as never;
    } as typeof original;
  });
  await page.goto(`${server!.url}?render=off&live=1&hud=0${query}`);
  await connected(page);
  return { page, requested };
}

describe("the audio-only page (?render=off)", () => {
  it("plays a line and reports the whole event sequence with nothing drawn", { timeout: 60_000 }, async () => {
    server = await startServer({ staticDir, speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 }) } });
    const { page } = await openAudioOnly("");
    const driver = await Driver.connect(server.wsUrl);
    drivers.push(driver);
    driver.say("x".repeat(40), "u1"); // 1.6 s of speech
    const started = await driver.waitFor((m) => m.type === "speech_started" && m.utterance_id === "u1");
    const finished = await driver.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u1");
    expect(driver.events.filter((m) => m.type.startsWith("speech_")).map((m) => `${m.type}:${m.utterance_id}`)).toEqual(["speech_started:u1", "speech_finished:u1"]);
    expect(await page.evaluate(() => window.__vikaki!.live!.events)).toEqual(["started:u1", "finished:u1"]);
    expect(started).toBeDefined();
    // it really played (the page, not the hub's clock): the line's timing is reported by the page, and has audio but no frame
    expect(finished.timing).toMatchObject({ audio_ms: expect.any(Number) });
    expect((finished.timing as { frame_ms?: number }).frame_ms).toBeUndefined();
    expect(await page.evaluate(() => window.__vikaki!.audioOnly)).toBe(true);
  });

  it("loads no scene, avatar or lip-sync code, and never creates a WebGL context", { timeout: 60_000 }, async () => {
    server = await startServer({ staticDir, speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 10 }) } });
    const { page, requested } = await openAudioOnly("");
    const driver = await Driver.connect(server.wsUrl);
    drivers.push(driver);
    driver.say("Hello.", "u1");
    await driver.waitFor((m) => m.type === "speech_finished");
    expect(await page.evaluate(() => (window as unknown as { __gl: number }).__gl)).toBe(0);
    expect(await page.evaluate(() => document.getElementById("stage"))).toBeNull();
    const heavy = requested.filter((p) => /\.vrm$|default\.bin$|avatar-page|wlipsync|three/i.test(p));
    expect(heavy, `these were fetched: ${requested.join(" ")}`).toEqual([]);
  });

  it("for one persona plays only that persona's lines, next to an avatar page for the other", { timeout: 90_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-audio-only-"));
    await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n    voice: af_heart\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n    voice: am_adam\n`);
    server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 20 }) } });
    const { page: adaAudio } = await openAudioOnly("&persona=ada"); // ada is only heard
    const benPage = await browser.newPage({ viewport: { width: 320, height: 240 } }); // ben is seen too
    pages.push(benPage);
    await benPage.goto(`${server.url}?persona=ben&live=1&hud=0&seed=3`);
    await connected(benPage);
    const driver = await Driver.connect(server.wsUrl);
    drivers.push(driver);
    driver.say("Hello from ada.", "u1", "ada");
    await driver.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u1");
    driver.say("Hello from ben.", "u2", "ben");
    await driver.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u2");
    expect(await adaAudio.evaluate(() => window.__vikaki!.live!.events)).toEqual(["started:u1", "finished:u1"]);
    expect(await benPage.evaluate(() => window.__vikaki!.live!.events)).toEqual(["started:u2", "finished:u2"]);
  });
});
