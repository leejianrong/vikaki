import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { frameHtml, pixelAt, serveHost, type HostPage } from "./host-page.ts";
import { SeatDriver, SEATS } from "./seat-driver.ts";

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

describe("the duet layout (VIK-68)", () => {
  type Duet = NonNullable<NonNullable<Window["__vikaki"]>["table"]>["duet"] & {};
  const duetOf = (frame: Frame) => frame.evaluate(() => window.__vikaki!.table!.duet as Duet);
  const MAGENTA = [255, 0, 255];
  /** Every pixel sampled in the rectangle shows the host's colour (within a rounding of 3), so nothing of the page is drawn there. */
  async function bandIsClear(page: Page, band: Duet["band"]) {
    const pts: [number, number][] = [];
    for (let x = band.left + 1; x < band.left + band.width - 1; x += 10) for (let y = band.top + 1; y < band.top + band.height - 1; y += 10) pts.push([Math.round(x), Math.round(y)]);
    const dirty = (await pixelAt(browser, await page.screenshot(), pts)).map((p, i) => ({ at: pts[i], p })).filter(({ p }) => p.some((c, k) => k < 3 && Math.abs(c - MAGENTA[k]!) > 3));
    return { sampled: pts.length, dirty: dirty.slice(0, 5) };
  }
  const speak = async (frame: Frame, text = "x".repeat(120)) => {
    const [d1, d2] = await Promise.all(SEATS.slice(0, 2).map((s) => SeatDriver.connect(server!.wsUrl, s)));
    drivers.push(d1!, d2!);
    d1!.say(text, "u1");
    await frame.waitForFunction(() => window.__vikaki!.table!.duet!.speaker === "seat-1" && window.__vikaki!.table!.duet!.halo[0]! > 0.95, null, { timeout: 15_000 });
    return { d1: d1!, d2: d2! };
  };
  const drivers: SeatDriver[] = [];
  afterEach(() => {
    for (const d of drivers.splice(0)) d.ws.terminate();
  });

  for (const [name, viewport, stacked] of [["desktop", { width: 1280, height: 720 }, false], ["a small laptop", { width: 960, height: 540 }, false], ["a phone", { width: 390, height: 844 }, true]] as const) {
    it(`on ${name}: the speaker is lit, the other dimmed, and the band is clear of any pixel of ours`, { timeout: 120_000, tags: name === "desktop" ? ["smoke"] : [] }, async () => {
      const { page, frame } = await embed("seats=2&embed=1&layout=duet", viewport);
      expect(await chrome(frame)).toEqual([]);
      const idle = await duetOf(frame);
      expect(idle.stacked).toBe(stacked);
      expect(idle.speaker).toBeNull();
      expect(idle.lit).toEqual([1, 1]); // nobody speaking: both look normal
      expect(idle.halo).toEqual([0, 0]);
      expect((await bandIsClear(page, idle.band)).dirty).toEqual([]);

      await speak(frame);
      const d = await duetOf(frame);
      expect(d.speaker).toBe("seat-1");
      expect(d.lit[0]).toBe(1);
      expect(d.lit[1]).toBeLessThan(0.1); // dimmed (eased to its floor)
      expect(d.halo[1]).toBe(0);
      const looks = await frame.evaluate(() => window.__vikaki!.table!.seats.map((s) => s.look));
      expect(looks[0]).toBe(0); // the speaker looks ahead
      expect(looks[1]).toBeLessThan(0); // the listener, on the right, glances left toward the speaker
      const { sampled, dirty } = await bandIsClear(page, d.band);
      expect(sampled).toBeGreaterThan(100);
      expect(JSON.stringify(dirty), "pixels drawn inside the band while the left seat speaks").toBe("[]");
      // something is drawn on both sides of it, so the clear band is not a blank frame
      const outside: [number, number][] = [];
      for (let x = 10; x < viewport.width; x += 20) for (let y = 10; y < viewport.height; y += 20) if (x < d.band.left || x > d.band.left + d.band.width || y < d.band.top) outside.push([x, y]);
      const drawn = (await pixelAt(browser, await page.screenshot(), outside)).filter(([r, g, b]) => !(r === 255 && g === 0 && b === 255));
      expect(drawn.length).toBeGreaterThan(20);
    });
  }

  it("moves the light when the other seat speaks", { timeout: 120_000 }, async () => {
    const { frame } = await embed("seats=2&embed=1&layout=duet");
    const { d1, d2 } = await speak(frame, "x".repeat(20));
    await d1.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u1");
    d2.say("x".repeat(120), "u2");
    await frame.waitForFunction(() => window.__vikaki!.table!.duet!.speaker === "seat-2" && window.__vikaki!.table!.duet!.halo[1]! > 0.95 && window.__vikaki!.table!.duet!.halo[0]! < 0.05, null, { timeout: 15_000 });
    const d = await duetOf(frame);
    expect([d.lit[1], d.lit[0]! < 0.1]).toEqual([1, true]);
  });

  it("refuses a table that is not two seats, and says so", { timeout: 90_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-embed-e2e-"));
    await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n`);
    server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")) });
    const page = await browser.newPage();
    pages.push(page);
    await page.goto(`${server.url}?seats=3&layout=duet`);
    await page.waitForFunction(() => document.getElementById("hud")?.textContent?.includes("layout=duet needs exactly two seats, got 3"), null, { timeout: 30_000 });
  });
});
