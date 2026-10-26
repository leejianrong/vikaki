import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

// The Mouth menu and the phonemes chip of the speech demo (VIK-51): how to see the phoneme mouth beside the old one.
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;
const pages: Page[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {})));
  await server?.close();
  server = undefined;
});

async function open(phonemes: boolean, query = ""): Promise<Page> {
  server = await startServer({ staticDir, speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 50, pieces: true }), phonemes } });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  pages.push(page);
  await page.goto(`${server.url}?demo=speech&live=1&seed=3${query}`);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
  await expect.poll(() => page.getByRole("button", { name: "Speak", exact: true }).isEnabled(), { timeout: 20_000 }).toBe(true);
  return page;
}
const chip = (page: Page) => page.locator(".chip", { hasText: "phonemes:" }).innerText();

describe("the speech demo's mouth", () => {
  it("offers three mouths, starts on hybrid, and reloads on the one chosen", { timeout: 90_000 }, async () => {
    const page = await open(true);
    expect(await page.evaluate(() => window.__vikaki!.mouthMode)).toBe("hybrid");
    // The menu is a Material component whose label is a property, not an attribute: find it by its label.
    const menu = () => page.evaluateHandle(() => [...document.querySelectorAll("md-outlined-select")].find((m) => (m as HTMLElement & { label: string }).label === "Mouth") as HTMLElement & { value: string });
    expect(await (await menu()).evaluate((m) => m.value)).toBe("hybrid");
    expect(await (await menu()).evaluate((m) => [...m.querySelectorAll("md-select-option")].map((o) => (o as HTMLElement & { value: string }).value))).toEqual(["hybrid", "phoneme", "audio"]);
    await (await menu()).evaluate((m) => {
      m.value = "audio";
      m.dispatchEvent(new Event("change"));
    });
    await page.waitForURL(/mouth=audio/, { timeout: 15_000 });
    await page.waitForFunction(() => window.__vikaki?.ready === true && window.__vikaki.mouthMode === "audio", null, { timeout: 30_000 });
    expect(await (await menu()).evaluate((m) => m.value)).toBe("audio");
  });

  it("says how many sounds the hub timed once a line is spoken, with the mouth in use", { timeout: 90_000 }, async () => {
    const page = await open(true);
    expect(await chip(page)).toBe("phonemes: waiting for a line");
    await page.getByRole("button", { name: "Speak", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".chip")].some((c) => /phonemes: \d+ sounds timed \(mouth: hybrid\)/.test(c.textContent ?? "")), null, { timeout: 20_000 });
  });

  it("says plainly that none were sent, and why the mouth looks as before, when the hub was not started with --phonemes", { timeout: 90_000 }, async () => {
    const page = await open(false);
    await page.getByRole("button", { name: "Speak", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".chip")].some((c) => /none sent.*--phonemes/.test(c.textContent ?? "")), null, { timeout: 20_000 });
  });
});
