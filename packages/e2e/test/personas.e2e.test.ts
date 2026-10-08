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

/** A driver that remembers everything the hub told it. */
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
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  say(text: string, id: string, persona: string) {
    this.send({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: `seat-${persona}`, utterance_id: id, text, persona });
  }
  async waitFor(pred: (m: Msg) => boolean, ms = 40_000): Promise<void> {
    const end = Date.now() + ms;
    while (!this.events.some(pred)) {
      if (Date.now() > end) throw new Error(`timed out; saw ${this.events.map((e) => e.type).join(",")}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  count(pred: (m: Msg) => boolean) {
    return this.events.filter(pred).length;
  }
}

let browser: Browser;
let server: RunningServer | undefined;
let fake: FakeTts;
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

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "vikaki-personas-e2e-"));
  await writeFile(
    join(dir, "personas.yaml"),
    `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n    voice: af_heart\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n    voice: am_adam\n`,
  );
  fake = new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 });
  server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: fake } });
  const open = async (persona: string) => {
    const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
    pages.push(page);
    await page.goto(`${server!.url}?persona=${persona}&live=1&seed=3`);
    await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.live.soundBlocked === false, null, { timeout: 30_000 });
    return page;
  };
  const ada = await open("ada");
  const ben = await open("ben");
  const driver = await Driver.connect(server.wsUrl);
  drivers.push(driver);
  return { ada, ben, driver };
}

const events = (page: Page) => page.evaluate(() => window.__vikaki!.live!.events);
const meanColour = (page: Page) =>
  page.evaluate(async () => {
    const canvas = document.getElementById("stage") as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = copy.height = 32;
    copy.getContext("2d")!.drawImage(canvas, canvas.width * 0.3, canvas.height * 0.3, canvas.width * 0.4, canvas.height * 0.4, 0, 0, 32, 32);
    const px = copy.getContext("2d")!.getImageData(0, 0, 32, 32).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += px[i + c]!;
    return sum.map((v) => v / (px.length / 4));
  });

describe("two pages, two personas", () => {
  it("each page loads its own persona's avatar, and the two look different", { timeout: 90_000 }, async () => {
    const { ada, ben } = await setup();
    expect(await ada.evaluate(() => [window.__vikaki!.persona, window.__vikaki!.avatarUrl])).toEqual(["ada", "/avatar/personas/ada.vrm"]);
    expect(await ben.evaluate(() => [window.__vikaki!.persona, window.__vikaki!.avatarUrl])).toEqual(["ben", "/avatar/personas/ben.vrm"]);
    const [a, b] = [await meanColour(ada), await meanColour(ben)];
    const distance = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    expect(distance, `mean colours ${a.map(Math.round)} vs ${b.map(Math.round)}`).toBeGreaterThan(40); // a brown gingerbread man and a pale snowman
    expect(await ada.locator("#hud").innerText()).toContain("ada");
  });

  it("plays each line on its own persona's page only, with that persona's voice, and the driver hears each once", { timeout: 90_000 }, async () => {
    const { ada, ben, driver } = await setup();
    driver.say("Hello from ada.", "u1", "ada");
    await driver.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u1");
    driver.say("And hello from ben.", "u2", "ben");
    await driver.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u2");
    expect(await events(ada)).toEqual(["started:u1", "finished:u1"]);
    expect(await events(ben)).toEqual(["started:u2", "finished:u2"]);
    expect(fake.voices).toEqual(["af_heart", "am_adam"]);
    for (const id of ["u1", "u2"]) {
      expect(driver.count((m) => m.type === "speech_started" && m.utterance_id === id)).toBe(1);
      expect(driver.count((m) => m.type === "speech_finished" && m.utterance_id === id)).toBe(1);
    }
  });

  it("the other persona's mouth stays shut while one speaks", { timeout: 90_000 }, async () => {
    const { ada, ben, driver } = await setup();
    const sample = (page: Page, ms: number) =>
      page.evaluate(async (t) => {
        let max = 0;
        const end = performance.now() + t;
        while (performance.now() < end) {
          max = Math.max(max, ...Object.values(window.__vikaki!.visemes));
          await new Promise((r) => setTimeout(r, 25));
        }
        return max;
      }, ms);
    const [adaMouth, benMouth] = [sample(ada, 2500), sample(ben, 2500)];
    driver.say("x".repeat(40), "u1", "ada"); // 1.6 s
    expect(await adaMouth).toBeGreaterThan(0.3);
    expect(await benMouth).toBeLessThan(0.05);
  });

  it("shows a turn's thinking on the page of the persona it names only", { timeout: 60_000 }, async () => {
    const { ada, ben, driver } = await setup();
    driver.send(make("turn_started", { seat_id: "seat-ben", persona: "ben" }));
    await ben.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === "dots", null, { timeout: 15_000 });
    await ada.waitForTimeout(600);
    expect(await ada.evaluate(() => window.__vikaki!.emotionPose!.symbol)).toBeNull();
    driver.send(make("turn_ended", { seat_id: "seat-ben", persona: "ben" }));
    await ben.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === null, null, { timeout: 15_000 });
  });

  it("a page for a persona the hub does not have says so and lists the ones it does", { timeout: 60_000 }, async () => {
    await setup();
    const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
    pages.push(page);
    await page.goto(`${server!.url}?persona=zed&live=1`);
    await page.waitForFunction(() => document.getElementById("hud")!.textContent!.includes("zed"), null, { timeout: 15_000 });
    const hud = await page.locator("#hud").innerText();
    expect(hud).toContain('no persona "zed"');
    expect(hud).toContain("ada, ben");
  });
});
