import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { SeatDriver, SEATS } from "./seat-driver.ts";

// The table page: one scene, three avatars, three seat drivers (VIK-47).
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

async function setup(query = "seats=3", viewport = { width: 960, height: 540 }, withDrivers = true) {
  const dir = await mkdtemp(join(tmpdir(), "vikaki-table-e2e-"));
  await writeFile(
    join(dir, "personas.yaml"),
    `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n    voice: af_heart\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n    voice: am_adam\n  cy:\n    avatar: ${join(avatars, "cookieman.vrm")}\n    voice: bf_emma\n`,
  );
  const fake = new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 });
  server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: fake } });
  const page = await browser.newPage({ viewport });
  pages.push(page);
  await page.goto(`${server.url}?${query}&seed=3`);
  await page.waitForFunction(() => window.__vikaki?.ready === true && window.__vikaki.live?.state === "connected" && window.__vikaki.live.soundBlocked === false, null, { timeout: 40_000 });
  const ds = withDrivers ? await Promise.all(SEATS.map((s) => SeatDriver.connect(server!.wsUrl, s))) : [];
  drivers.push(...ds);
  return { page, drivers: ds as [SeatDriver, SeatDriver, SeatDriver], fake };
}

const seatsOf = (page: Page) => page.evaluate(() => window.__vikaki!.table!.seats.map((s) => ({ seat: s.seat, persona: s.persona, avatarUrl: s.avatarUrl, x: s.x, symbol: s.symbol })));
/** The largest mouth opening each seat's avatar showed over `ms`. */
const maxMouths = (page: Page, ms: number) =>
  page.evaluate(async (t) => {
    const max = [0, 0, 0];
    const end = performance.now() + t;
    while (performance.now() < end) {
      window.__vikaki!.table!.seats.forEach((s, i) => (max[i] = Math.max(max[i]!, ...Object.values(s.visemes))));
      await new Promise((r) => setTimeout(r, 25));
    }
    return max;
  }, ms);

describe("the table page", () => {
  it("lays three seats out left to right, each with its persona's avatar, on a canvas the stylesheet sizes", { tags: ["smoke"], timeout: 90_000 }, async () => {
    const { page } = await setup();
    const seats = await seatsOf(page);
    expect(seats.map((s) => [s.seat, s.persona])).toEqual([["seat-1", "ada"], ["seat-2", "ben"], ["seat-3", "cy"]]);
    expect(seats.map((s) => s.avatarUrl)).toEqual(["/avatar/personas/ada.vrm", "/avatar/personas/ben.vrm", "/avatar/personas/cy.vrm"]);
    expect(seats[0]!.x).toBeLessThan(seats[1]!.x);
    expect(seats[1]!.x).toBeLessThan(seats[2]!.x);
    expect(seats[0]!.x + seats[2]!.x).toBeCloseTo(0, 5); // centred
    const box = await page.evaluate(() => {
      const c = document.getElementById("stage") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height), inlineStyle: c.getAttribute("style") };
    });
    expect(box.inlineStyle ?? "").not.toContain("width"); // the stylesheet decides the size (ADR-0012)
    expect(box.inlineStyle ?? "").not.toContain("height");
    expect([box.width, box.height]).toEqual([960, 540]);
    expect(await page.locator("#hud").innerText()).toContain("table of 3");
  });

  it("follows the canvas when the window changes shape, and keeps no inline size", { timeout: 90_000 }, async () => {
    const { page } = await setup();
    await page.setViewportSize({ width: 500, height: 800 });
    // The canvas is laid out at once, but the drawing buffer follows when the page's ResizeObserver runs: wait for that, not just the layout.
    await page.waitForFunction(() => {
      const c = document.getElementById("stage") as HTMLCanvasElement;
      return c.clientWidth === 500 && Math.abs(c.width / c.height - 500 / 800) < 0.05;
    });
    const box = await page.evaluate(() => {
      const c = document.getElementById("stage") as HTMLCanvasElement;
      return { w: c.clientWidth, h: c.clientHeight, buffer: [c.width, c.height], inlineStyle: c.getAttribute("style") };
    });
    expect([box.w, box.h]).toEqual([500, 800]);
    expect(box.buffer[0]! / box.buffer[1]!).toBeCloseTo(500 / 800, 1); // the drawing buffer matches the canvas, so nothing is stretched
    expect(box.inlineStyle ?? "").not.toContain("width");
  });

  it("speech on one seat moves that seat's mouth and not the other two", { timeout: 90_000 }, async () => {
    const { page, drivers: [, d2] } = await setup();
    const watching = maxMouths(page, 2500);
    d2.say("x".repeat(40), "u1"); // 1.6 s
    const [m1, m2, m3] = await watching;
    expect(m2).toBeGreaterThan(0.3);
    expect(m1).toBeLessThan(0.05);
    expect(m3).toBeLessThan(0.05);
  });

  it("plays each seat's line in turn on its own avatar, and each driver hears only its own", { timeout: 120_000 }, async () => {
    const { page, fake, drivers: [d1, d2, d3] } = await setup();
    for (const [d, id] of [[d1, "u1"], [d2, "u2"], [d3, "u3"]] as const) {
      // the last line's mouth takes a moment to close (the lip-sync node smooths), so start from every mouth shut
      await page.waitForFunction(() => window.__vikaki!.table!.seats.every((s) => Math.max(0, ...Object.values(s.visemes)) < 0.05), null, { timeout: 15_000 });
      const watching = maxMouths(page, 1800);
      d.say("x".repeat(25), id);
      await d.waitFor((m) => m.type === "speech_finished" && m.utterance_id === id);
      const opened = (await watching).map((m) => m > 0.3);
      expect(opened, `${id} should move only seat ${d.seat.seat_id}`).toEqual(SEATS.map((s) => s.seat_id === d.seat.seat_id));
    }
    expect(await page.evaluate(() => window.__vikaki!.live!.events)).toEqual(["started:u1", "finished:u1", "started:u2", "finished:u2", "started:u3", "finished:u3"]);
    expect(fake.voices).toEqual(["af_heart", "am_adam", "bf_emma"]);
    expect([d1.heard("speech_finished"), d2.heard("speech_finished"), d3.heard("speech_finished")]).toEqual([["u1"], ["u2"], ["u3"]]);
  });

  it("shows a seat's thinking turn over that avatar only, and clears it", { timeout: 90_000 }, async () => {
    const { page, drivers: [, , d3] } = await setup();
    d3.send("turn_started");
    await page.waitForFunction(() => window.__vikaki!.table!.seats[2]!.symbol === "dots", null, { timeout: 15_000 });
    expect((await seatsOf(page)).map((s) => s.symbol)).toEqual([null, null, "dots"]);
    d3.send("turn_ended");
    await page.waitForFunction(() => window.__vikaki!.table!.seats[2]!.symbol === null, null, { timeout: 15_000 });
  });

  it("plays `vikaki table-demo`'s scripted hand: each seat thinks, then speaks, in turn, on its own avatar", { timeout: 180_000 }, async () => {
    const { page } = await setup("seats=3", { width: 960, height: 540 }, false);
    // Watch the whole hand from inside the page: who has the mouth open, and who shows the thinking dots.
    await page.evaluate(() => {
      const spoke: number[] = [];
      const thought = new Set<number>();
      (window as unknown as { __watch: { spoke: number[]; thought: Set<number> } }).__watch = { spoke, thought };
      setInterval(() => {
        const seats = window.__vikaki!.table!.seats;
        seats.forEach((s, i) => s.symbol === "dots" && thought.add(i));
        const open = seats.map((s) => Math.max(0, ...Object.values(s.visemes)));
        const loudest = open.indexOf(Math.max(...open));
        if (open[loudest]! > 0.3 && spoke[spoke.length - 1] !== loudest) spoke.push(loudest);
      }, 20);
    });
    const cliDir = fileURLToPath(new URL("../../cli", import.meta.url));
    const cliEntry = join(cliDir, "src/index.ts");
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, "table-demo", "--url", server!.wsUrl, "--pace", "0.25"], { cwd: cliDir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const code = await new Promise<number | null>((ok) => child.once("exit", ok));
    expect(code, out).toBe(0);
    const { spoke, thought } = await page.evaluate(() => {
      const w = (window as unknown as { __watch: { spoke: number[]; thought: Set<number> } }).__watch;
      return { spoke: w.spoke, thought: [...w.thought].sort() };
    });
    expect(spoke, "who spoke, in order: ada, ben, cy, ada, ben, ada, ben, ada, ben").toEqual([0, 1, 2, 0, 1, 0, 1, 0, 1]);
    expect(thought, "every seat that has a thinking beat showed the dots").toEqual([0, 1, 2]);
    expect(out).toContain("hand over");
  });

  it("names the persona it cannot find, and takes explicit seat:persona pairs", { timeout: 90_000 }, async () => {
    const { page } = await setup("seats=north:ada,south:ben");
    expect((await seatsOf(page)).map((s) => [s.seat, s.persona])).toEqual([["north", "ada"], ["south", "ben"]]);
    const bad = await browser.newPage({ viewport: { width: 480, height: 400 } });
    pages.push(bad);
    await bad.goto(`${server!.url}?seats=ada,zed`);
    await bad.waitForFunction(() => document.getElementById("hud")!.textContent!.includes("zed"), null, { timeout: 15_000 });
    const hud = await bad.locator("#hud").innerText();
    expect(hud).toContain('no persona "zed"');
    expect(hud).toContain("ada, ben, cy");
  });
});
