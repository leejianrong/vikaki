import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { SeatDriver, SEATS } from "./seat-driver.ts";

// Three LLM seats at one table: each is its own driver, bound to a persona, and each persona has its own page.
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const avatars = fileURLToPath(new URL("../../engine/public/avatars/", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;
const pages: Page[] = [];
const drivers: SeatDriver[] = [];

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
  const dir = await mkdtemp(join(tmpdir(), "vikaki-seats-e2e-"));
  const avatar = (n: string) => join(avatars, n);
  await writeFile(
    join(dir, "personas.yaml"),
    `personas:\n  ada:\n    avatar: ${avatar("cookieman.vrm")}\n    voice: af_heart\n  ben:\n    avatar: ${avatar("snowy.vrm")}\n    voice: am_adam\n  cy:\n    avatar: ${avatar("cookieman.vrm")}\n    voice: bf_emma\n`,
  );
  const fake = new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 });
  server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: fake } });
  const open = async (persona: string) => {
    const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
    pages.push(page);
    await page.goto(`${server!.url}?persona=${persona}&live=1&seed=3`);
    await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.live.soundBlocked === false, null, { timeout: 30_000 });
    return page;
  };
  const [p1, p2, p3] = [await open("ada"), await open("ben"), await open("cy")];
  const [d1, d2, d3] = await Promise.all(SEATS.map((s) => SeatDriver.connect(server!.wsUrl, s)));
  drivers.push(d1!, d2!, d3!);
  return { fake, pages: [p1, p2, p3] as const, drivers: [d1!, d2!, d3!] as const };
}

const events = (page: Page) => page.evaluate(() => window.__vikaki!.live!.events);
const maxMouth = (page: Page, ms: number) =>
  page.evaluate(async (t) => {
    let max = 0;
    const end = performance.now() + t;
    while (performance.now() < end) {
      max = Math.max(max, ...Object.values(window.__vikaki!.visemes));
      await new Promise((r) => setTimeout(r, 25));
    }
    return max;
  }, ms);

describe("three seats, each its own driver, each its own page", () => {
  it("speech on one seat moves that seat's avatar and not the other two", { timeout: 90_000 }, async () => {
    const { pages: [p1, p2, p3], drivers: [d1] } = await setup();
    const watching = [maxMouth(p1, 2500), maxMouth(p2, 2500), maxMouth(p3, 2500)];
    d1.say("x".repeat(40), "u1"); // 1.6 s
    const [m1, m2, m3] = await Promise.all(watching);
    expect(m1).toBeGreaterThan(0.3);
    expect(m2).toBeLessThan(0.05);
    expect(m3).toBeLessThan(0.05);
  });

  it("plays each seat's line on its own page with its persona's voice, and each driver hears only its own line", { timeout: 120_000 }, async () => {
    const { fake, pages: [p1, p2, p3], drivers: [d1, d2, d3] } = await setup();
    for (const [d, id] of [[d1, "u1"], [d2, "u2"], [d3, "u3"]] as const) {
      d.say(`Hello from ${d.seat.persona}.`, id);
      await d.waitFor((m) => m.type === "speech_finished" && m.utterance_id === id);
    }
    expect(await events(p1)).toEqual(["started:u1", "finished:u1"]);
    expect(await events(p2)).toEqual(["started:u2", "finished:u2"]);
    expect(await events(p3)).toEqual(["started:u3", "finished:u3"]);
    expect(fake.voices).toEqual(["af_heart", "am_adam", "bf_emma"]);
    expect(d1.heard("speech_finished")).toEqual(["u1"]);
    expect(d2.heard("speech_finished")).toEqual(["u2"]);
    expect(d3.heard("speech_finished")).toEqual(["u3"]);
  });

  it("shows a seat's turn on its own page only", { timeout: 60_000 }, async () => {
    const { pages: [p1, p2, p3], drivers: [, d2] } = await setup();
    d2.send("turn_started"); // no persona named: the seat's is used
    await p2.waitForFunction(() => window.__vikaki!.emotionPose!.symbol === "dots", null, { timeout: 15_000 });
    await p1.waitForTimeout(600);
    expect(await p1.evaluate(() => window.__vikaki!.emotionPose!.symbol)).toBeNull();
    expect(await p3.evaluate(() => window.__vikaki!.emotionPose!.symbol)).toBeNull();
  });
});
