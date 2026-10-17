import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { frameHtml, pixelAt, serveHost, type HostPage } from "./host-page.ts";

// Embed mode (VIK-64): /avatar?embed=1 framed by a page on another origin shows the avatars and nothing else, on a see-through background.
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const avatars = fileURLToPath(new URL("../../engine/public/avatars/", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;
let host: HostPage | undefined;
const pages: Page[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {})));
  await host?.close();
  await server?.close();
  host = server = undefined;
});

/** The hub with two personas, a host page framing `/avatar?<query>`, and the frame once it has drawn. */
async function embed(query: string, viewport = { width: 960, height: 540 }, colorScheme: "light" | "dark" = "dark") {
  const dir = await mkdtemp(join(tmpdir(), "vikaki-embed-e2e-"));
  await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n`);
  server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 }) } });
  host = await serveHost(() => frameHtml(`${server!.url}?${query}&seed=3`));
  const page = await browser.newPage({ viewport, colorScheme });
  pages.push(page);
  await page.goto(host.origin);
  const handle = await page.waitForSelector("#avatar");
  const frame = (await handle.contentFrame()) as Frame;
  await frame.waitForFunction(() => window.__vikaki?.ready === true && window.__vikaki.live?.state === "connected", null, { timeout: 40_000 });
  return { page, frame };
}

/** What the frame shows besides the canvas: every visible element with text of its own. */
const chrome = (frame: Frame) =>
  frame.evaluate(() =>
    [...document.body.querySelectorAll("*")]
      .filter((e) => !["CANVAS", "SCRIPT"].includes(e.tagName))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none" && [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
      })
      .map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}.${e.className}`),
  );

describe("embed mode", () => {
  it("shows only the avatars of a table, on a background the host page shows through, even when the system is dark", { tags: ["smoke"], timeout: 90_000 }, async () => {
    const { page, frame } = await embed("seats=2&embed=1");
    expect(await chrome(frame)).toEqual([]); // no pot strip, no name plates, no transcript, no HUD text
    const box = await frame.evaluate(() => {
      const c = document.getElementById("stage") as HTMLCanvasElement;
      return { w: c.clientWidth, h: c.clientHeight, inline: c.getAttribute("style") };
    });
    expect([box.w, box.h]).toEqual([960, 540]);
    expect(box.inline ?? "").not.toMatch(/width|height/); // ADR-0012
    // The host paints magenta behind the frame. The corners are empty sky: magenta must show through them.
    const png = await page.screenshot();
    const corners = await pixelAt(browser, png, [[4, 4], [955, 4], [4, 535], [955, 535]]);
    for (const [r, g, b] of corners) expect([r, g, b]).toEqual([255, 0, 255]);
    // ... and something is drawn in the middle, so the test is not passing on a blank frame.
    const grid: [number, number][] = [];
    for (let x = 20; x < 960; x += 40) for (let y = 40; y < 540; y += 40) grid.push([x, y]);
    const drawn = (await pixelAt(browser, png, grid)).filter(([r, g, b]) => !(r === 255 && g === 0 && b === 255));
    expect(drawn.length).toBeGreaterThan(10);
  });

  it("works for one persona, and &bg= paints a solid colour", { timeout: 90_000 }, async () => {
    const { page, frame } = await embed("embed=1&live=1&persona=ben&bg=00b140");
    expect(await chrome(frame)).toEqual([]);
    const [corner] = await pixelAt(browser, await page.screenshot(), [[4, 4]]);
    expect(corner).toEqual([0, 177, 64, 255]);
  });

  it("brings back the name plates and the transcript when asked, and never the pot strip", { timeout: 90_000 }, async () => {
    const { frame } = await embed("seats=2&embed=1&names=1&captions=1");
    const shown = await chrome(frame);
    expect(shown.some((s) => s.startsWith("span.name"))).toBe(true);
    expect(shown.some((s) => s.includes("table-info"))).toBe(false);
  });

  it("changes nothing without ?embed=1: the plates are there", { timeout: 90_000 }, async () => {
    const { frame } = await embed("seats=2");
    expect((await chrome(frame)).some((s) => s.startsWith("span.name"))).toBe(true);
  });
});
