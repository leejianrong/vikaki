import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeWav, startServer, type RunningServer } from "@vikaki/server";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const RATE = 48000;

/** A voice-like tone with a pitch contour and loudness, as `ProsodyTracker`'s own tests make. */
function voice(seconds: number, f0: (t: number) => number, amp: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * f0(t)) / RATE;
    out[i] = (amp(t) * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase))) / 1.75;
  }
  return out;
}

/** 0.6 s quiet, a 2 s phrase (a stressed word at 0.9 s, a rising end after 1.4 s), 2 s quiet. Chromium's fake mic loops it. */
async function makeFixture(): Promise<string> {
  const phrase = voice(2, (t) => (t < 1.4 ? 120 : 120 + (t - 1.4) * 110), (t) => (t > 0.9 && t < 1.1 ? 0.7 : 0.25));
  const clip = new Float32Array(RATE * 4.6);
  clip.set(phrase, Math.round(0.6 * RATE));
  const dir = await mkdtemp(join(tmpdir(), "vikaki-prosody-"));
  const file = join(dir, "phrase.wav");
  await writeFile(file, encodeWav(clip, RATE));
  return file;
}

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
      `--use-file-for-fake-audio-capture=${await makeFixture()}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("mic mode answers the way the voice goes", () => {
  it("finds the stress, the rising ending and the pause in a phrase, and moves the head for them", { timeout: 90_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await page.goto(`${server.url}?mode=mic&hud=0&seed=3`);
    await page.waitForFunction(() => window.__vikaki?.mic === "listening", null, { timeout: 30_000 });
    // Watch the gestures while the loop plays: the largest tilt and nod they add to the head (the idle sway is not in these).
    await page.evaluate(() => {
      const w = window as unknown as { __tilt: number; __nod: number };
      w.__tilt = 0;
      w.__nod = 0;
      setInterval(() => {
        const g = window.__vikaki!.gesture!;
        w.__tilt = Math.max(w.__tilt, Math.abs(g.roll));
        w.__nod = Math.max(w.__nod, g.pitch);
      }, 20);
    });
    await page.waitForFunction(
      () => {
        const kinds = new Set(window.__vikaki!.prosody!.cues.map((c) => c.cue));
        return kinds.has("emphasis") && kinds.has("rise") && kinds.has("pause");
      },
      null,
      { timeout: 40_000 },
    );
    const { tilt, nod } = await page.evaluate(() => ({ tilt: (window as unknown as { __tilt: number }).__tilt, nod: (window as unknown as { __nod: number }).__nod }));
    expect(tilt).toBeGreaterThan(0.05); // the head tipped for the rising ending
    expect(nod).toBeGreaterThan(0.05); // and nodded for the stress
    await page.close();
  });

  it("finds nothing in a quiet room", { timeout: 60_000 }, async () => {
    const quiet = await chromium.launch({
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    try {
      const page = await quiet.newPage({ viewport: { width: 640, height: 480 } });
      await page.goto(`${server.url}?mode=mic&hud=0&seed=3`);
      await page.waitForFunction(() => window.__vikaki?.mic === "listening", null, { timeout: 30_000 });
      await page.waitForTimeout(4000);
      // Chromium's default fake mic beeps; a beep is a steady tone, not a voice getting louder or rising, so no cue
      const cues = await page.evaluate(() => window.__vikaki!.prosody!.cues.map((c) => c.cue));
      expect(cues.filter((c) => c !== "pause")).toEqual([]);
    } finally {
      await quiet.close();
    }
  });
});
