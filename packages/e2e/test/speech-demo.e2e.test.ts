import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make } from "@vikaki/protocol";
import { startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;
const pages: Page[] = [];
const sockets: WebSocket[] = [];

beforeAll(async () => {
  browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {})));
  await server?.close();
  server = undefined;
});

async function open(opts: { speech?: boolean; msPerChar?: number } = {}): Promise<Page> {
  server = await startServer({
    staticDir,
    speech: opts.speech === false ? undefined : { tts: new FakeTts({ sampleRate: 16000, msPerChar: opts.msPerChar ?? 50, chunkMs: 100 }) },
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  pages.push(page);
  await page.goto(`${server.url}?demo=speech&live=1&seed=3`);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
  return page;
}

const log = (page: Page) => page.locator("#log").innerText();
const logHas = (page: Page, text: string, ms = 15_000) =>
  page.waitForFunction((t) => document.getElementById("log")!.innerText.includes(t), text, { timeout: ms });
const stat = (page: Page, label: string) => page.locator(".stat", { hasText: label }).locator("b").innerText();
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

describe("speech demo", () => {
  it("shows that the driver is connected, which voice is in use, and that sound is on", async () => {
    const page = await open();
    await page.waitForFunction(() => document.querySelector(".chip.ok")?.textContent === "driver: connected", null, { timeout: 15_000 });
    const chips = await page.locator(".chip").allInnerTexts();
    expect(chips[0]).toBe("driver: connected");
    expect(chips[1]).toContain("test voice");
    await page.waitForFunction(() => [...document.querySelectorAll(".chip")].some((c) => c.textContent === "sound: on"), null, { timeout: 15_000 });
  }, 60_000);

  it("speaks the typed text, logs what the hub reports, and measures it", async () => {
    const page = await open();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#speech button.primary")!.disabled, null, { timeout: 15_000 });
    await page.locator("#say-text").fill("x".repeat(40)); // 2 s
    await button(page, "Speak").click();
    await logHas(page, "speech started");
    await logHas(page, "speech finished");
    const text = await log(page);
    expect(text).toContain("sent");
    expect(text.indexOf("speech started")).toBeLessThan(text.indexOf("speech finished"));
    expect(await stat(page, "send → speech starts")).toMatch(/ms$|s$/);
    const length = await stat(page, "speech length");
    expect(parseFloat(length)).toBeGreaterThan(1.5);
    expect(parseFloat(length)).toBeLessThan(3.5);
  }, 60_000);

  it("moves the avatar's mouth while it speaks", async () => {
    const page = await open();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#speech button.primary")!.disabled, null, { timeout: 15_000 });
    await page.locator("#say-text").fill("x".repeat(40));
    const peak = page.evaluate(async () => {
      let max = 0;
      const end = performance.now() + 4000;
      while (performance.now() < end) {
        max = Math.max(max, ...Object.values(window.__vikaki!.visemes), 0);
        await new Promise((r) => setTimeout(r, 30));
      }
      return max;
    });
    await button(page, "Speak").click();
    expect(await peak).toBeGreaterThan(0.3);
  }, 60_000);

  it("cancels mid-speech, shows the interruption, and measures how fast it stopped", async () => {
    const page = await open();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#speech button.primary")!.disabled, null, { timeout: 15_000 });
    await button(page, "Long story").click();
    await button(page, "Speak").click();
    await logHas(page, "speech started");
    await page.waitForTimeout(500);
    expect(await button(page, "Cancel").isEnabled()).toBe(true);
    await button(page, "Cancel").click();
    await logHas(page, "speech interrupted", 3000);
    const text = await log(page);
    expect(text).not.toContain("speech finished");
    const stopped = await stat(page, "cancel → stopped");
    expect(parseFloat(stopped)).toBeLessThan(400);
    expect(stopped).toMatch(/ms$/);
    expect(await button(page, "Cancel").isDisabled()).toBe(true);
  }, 60_000);

  it("sends a streamed line word by word, and starts speaking before the end of it is sent", async () => {
    const page = await open({ msPerChar: 10 }); // speaks fast, so the time is dominated by the 5 words a second sent
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#speech button.primary")!.disabled, null, { timeout: 15_000 });
    await page.locator("#say-text").fill("This is the first sentence of a streamed line. And here are a good many more words coming afterwards, one at a time, like a model.");
    const clicked = Date.now();
    await button(page, "Speak, streamed word by word").click();
    await logHas(page, "speech started");
    const startedAfter = Date.now() - clicked;
    expect(startedAfter).toBeLessThan(3200); // the 24 words take about 4.8 s to send at 5 a second
    await logHas(page, "speech finished", 25_000);
    const finishedAfter = Date.now() - clicked;
    expect(finishedAfter).toBeGreaterThan(4400); // it cannot end before the last word has been sent
    expect(await log(page)).toContain("(streamed)");
  }, 90_000);

  it("fills the text box from a preset", async () => {
    const page = await open();
    await button(page, "Poker").click();
    expect(await page.locator("#say-text").inputValue()).toContain("bluffing");
  }, 60_000);

  it("says plainly when another program is already driving, and does not let you speak", async () => {
    server = await startServer({ staticDir, speech: { tts: new FakeTts() } });
    const other = new WebSocket(server.wsUrl);
    sockets.push(other);
    await new Promise((ok) => other.once("open", ok));
    other.send(JSON.stringify(make("hello", { role: "driver" })));
    await new Promise((r) => setTimeout(r, 150));
    const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
    pages.push(page);
    await page.goto(`${server.url}?demo=speech&live=1`);
    await page.waitForFunction(() => document.querySelector(".chip.bad")?.textContent?.includes("already driving"), null, { timeout: 20_000 });
    expect(await button(page, "Speak").isDisabled()).toBe(true);
    expect(await log(page)).toContain("Another program is already the driver");
  }, 60_000);

  it("says so when the hub has no speech engine", async () => {
    const page = await open({ speech: false });
    await page.waitForFunction(() => [...document.querySelectorAll(".chip")].some((c) => c.textContent?.startsWith("voice: off")), null, { timeout: 15_000 });
  }, 60_000);
});
