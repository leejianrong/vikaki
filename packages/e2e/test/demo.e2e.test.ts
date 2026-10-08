import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "@vikaki/server";

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

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
  await page.goto(`${server.url}?demo=1&seed=7`);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
  return page;
}

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
