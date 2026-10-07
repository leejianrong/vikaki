import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "@vikaki/server";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
// 1.5 s silence, 2 s synthetic "aah", 1.5 s silence, looped by Chromium's fake mic.
const fixture = fileURLToPath(new URL("../fixtures/vowel-aa.wav", import.meta.url));

let server: RunningServer;
let browser: Browser;

beforeAll(async () => {
  server = await startServer({ staticDir });
  browser = await chromium.launch({
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${fixture}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("mic mode", () => {
  it("opens the mouth on speech, closes it in silence, and never leaves localhost", async () => {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    const hosts = new Set<string>();
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http")) hosts.add(u.host);
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${server.url}?mode=mic&hud=0`);
    await page.waitForFunction(() => window.__vikaki?.mic === "listening", null, { timeout: 30_000 });

    // Sample the applied mouth weights for longer than one fixture loop (5 s).
    const samples = await page.evaluate(async () => {
      const out: number[] = [];
      const end = performance.now() + 8000;
      while (performance.now() < end) {
        out.push(Math.max(0, ...Object.values(window.__vikaki!.visemes)));
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    });

    expect(errors).toEqual([]);
    expect(Math.max(...samples)).toBeGreaterThan(0.3); // speech opens the mouth
    expect(Math.min(...samples)).toBeLessThan(0.05); // silence closes it
    expect([...hosts]).toEqual([new URL(server.url).host]); // R6: no network beyond the local server
    await page.close();
  });

  it("falls back to idle with a visible error when the mic is unavailable", async () => {
    const noMic = await chromium.launch({
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    });
    try {
      const page = await noMic.newPage({ viewport: { width: 640, height: 480 } });
      // Without the fake-device flags, headless Chromium has no audio input to grant.
      await page.goto(`${server.url}?mode=mic`);
      await page.waitForFunction(() => window.__vikaki?.mic === "error", null, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__vikaki!.ready)).toBe(true);
      expect(await page.locator("#hud").textContent()).toContain("mic error");
    } finally {
      await noMic.close();
    }
  });
});
