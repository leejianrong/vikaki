import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "@vikaki/server";
import { synthVowel } from "@vikaki/tts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
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

/** A WAV file of "aah" that stops while still loud, unlike the fixture, which fades into silence. */
function loudEndingWav(seconds: number, rate = 16000): Buffer {
  const samples = synthVowel(seconds, rate);
  const faded = samples.length - 1;
  samples[faded] = samples[faded - 1]!; // no fade-out: the last sample is as loud as the rest
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 3)) * 32767), i * 2)); // x3: well above the noise floor
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
  await page.goto(`${server.url}?demo=1&seed=7`);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
  return page;
}

/** Highest mouth weight seen over `ms` milliseconds. */
const peakOpen = (page: Page, ms: number) =>
  page.evaluate(async (t) => {
    let max = 0;
    const end = performance.now() + t;
    while (performance.now() < end) {
      max = Math.max(max, ...Object.values(window.__vikaki!.visemes), 0);
      await new Promise((r) => setTimeout(r, 40));
    }
    return max;
  }, ms);

/**
 * Highest mouth weight seen while an audio file plays. Waits for the panel to say it is playing,
 * then samples until it stops, so a slow machine (decode, WASM start-up) cannot cut the window short.
 */
const peakWhilePlaying = (page: Page) =>
  page.evaluate(async () => {
    const status = () => document.querySelector("#demo .status")?.textContent ?? "";
    const giveUp = performance.now() + 40_000;
    while (!status().includes("Playing") && performance.now() < giveUp) await new Promise((r) => setTimeout(r, 40));
    let max = 0;
    while (status().includes("Playing") && performance.now() < giveUp) {
      max = Math.max(max, ...Object.values(window.__vikaki!.visemes), 0);
      await new Promise((r) => setTimeout(r, 40));
    }
    return max;
  });

describe("demo panel", () => {
  it("shows the controls and the meters", async () => {
    const page = await open();
    for (const name of ["aa", "ih", "ou", "ee", "oh", "closed", "Blink now"]) {
      expect(await page.getByRole("button", { name, exact: true }).count()).toBe(1);
    }
    expect(await page.locator(".meter").count()).toBe(7); // 5 mouth shapes, blink, volume
    await page.close();
  });

  it("holds a mouth shape while a button is pressed and releases it after", async () => {
    const page = await open();
    const ou = page.getByRole("button", { name: "ou", exact: true });
    await ou.dispatchEvent("pointerdown");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__vikaki!.visemes)).toEqual({ ou: 1 });
    await ou.dispatchEvent("pointerup");
    await page.waitForTimeout(150);
    expect(Math.max(0, ...Object.values(await page.evaluate(() => window.__vikaki!.visemes)))).toBe(0);
    await page.close();
  });

  it("blinks when asked", async () => {
    const page = await open();
    const before = await page.evaluate(() => window.__vikaki!.blinks);
    await page.getByRole("button", { name: "Blink now" }).click();
    await page.waitForFunction((n) => window.__vikaki!.blinks > n, before, { timeout: 2000 });
    await page.close();
  });

  it("lip-syncs an audio file picked through the file input", async () => {
    const page = await open();
    const peak = peakWhilePlaying(page);
    await page.locator('#demo input[type="file"]').setInputFiles(fixture);
    expect(await peak).toBeGreaterThan(0.3);
    await page.close();
  }, 90_000);

  it("closes the mouth once an audio file has finished playing, even if it ended on a loud sound", async () => {
    const page = await open();
    const peak = peakWhilePlaying(page);
    await page.locator('#demo input[type="file"]').setInputFiles({ name: "loud-end.wav", mimeType: "audio/wav", buffer: loudEndingWav(1.5) });
    expect(await peak).toBeGreaterThan(0.3);
    await page.waitForTimeout(800); // let the smoothing settle
    expect(await peakOpen(page, 600)).toBeLessThan(0.05); // not frozen open on the last loud sound
    await page.close();
  }, 90_000);

  it("turns the mic on and off from the toggle", async () => {
    const page = await open();
    const mic = page.getByRole("button", { name: /^Microphone:/ });
    await mic.click();
    await page.waitForFunction(() => window.__vikaki!.mic === "listening", null, { timeout: 15_000 });
    expect(await mic.textContent()).toBe("Microphone: on");
    await mic.click();
    await page.waitForFunction(() => window.__vikaki!.mic === "idle", null, { timeout: 5000 });
    expect(await mic.textContent()).toBe("Microphone: off");
    await page.close();
  });

  it("explains a file it cannot decode instead of failing silently", async () => {
    const page = await open();
    await page.locator('#demo input[type="file"]').setInputFiles({ name: "not-audio.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await page.waitForFunction(() => document.querySelector("#demo .status")?.textContent?.includes("Could not play"), null, { timeout: 5000 });
    await page.close();
  });
});

describe("layout", () => {
  const canvasBox = (page: Page) =>
    page.evaluate(() => {
      const c = document.getElementById("stage") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { x: r.x, width: Math.round(r.width), height: Math.round(r.height), bufferWidth: c.width, inlineStyle: c.getAttribute("style") };
    });

  it.each([
    ["the demo page", "?demo=1&seed=7", "#demo"],
    ["the speech demo", "?demo=speech&live=1&seed=7", "#speech"],
  ])("%s: the canvas sits beside the panel, not under it, and follows the window size", async (_name, query, panelSel) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await page.goto(`${server.url}${query}`);
    await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
    const panel = await page.locator(panelSel).boundingBox();
    const box = await canvasBox(page);
    expect(box.inlineStyle ?? "").not.toContain("width"); // the stylesheet decides the size
    expect(box.x + box.width).toBeLessThanOrEqual(panel!.x + 1); // ends where the panel begins
    expect(box.bufferWidth).toBeGreaterThanOrEqual(box.width); // drawing buffer matches (pixel ratio 1 or more)

    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForFunction((w) => (document.getElementById("stage") as HTMLCanvasElement).width !== w, box.bufferWidth, { timeout: 5000 });
    const after = await canvasBox(page);
    expect(after.width).toBeLessThan(box.width);
    expect(after.x + after.width).toBeLessThanOrEqual((await page.locator(panelSel).boundingBox())!.x + 1);
    await page.close();
  }, 60_000);
});
