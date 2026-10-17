import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { make } from "@vikaki/protocol";
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
/** The largest mouth opening each seat's avatar showed over `ms`: the page keeps the peak of every frame it draws, so a slow page cannot miss a short one (VIK-75). */
const maxMouths = (page: Page, ms: number) =>
  page.evaluate(async (t) => {
    window.__vikaki!.table!.resetPeaks();
    await new Promise((r) => setTimeout(r, t));
    return window.__vikaki!.table!.seats.map((s) => s.peak.mouth);
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

  it("draws the game's table state: pot, board, a plate per seat with stack, bet, cards, dealer and turn, and the lines said (VIK-59)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1, d2] } = await setup();
    d2.ws.send(
      JSON.stringify(
        make("table_state", {
          pot: 1200,
          street: "flop",
          board: ["As", "Td", "7c"],
          dealer: "seat-1",
          turn: "seat-2",
          seats: [
            { seat_id: "seat-1", stack: 880, bet: 40, cards: ["Kh", "Qh"] },
            { seat_id: "seat-2", stack: 940, cards: ["back", "back"] },
            { seat_id: "seat-3", stack: 0, folded: true },
          ],
        }),
      ),
    );
    const table = page.getByRole("region", { name: "Table" });
    await table.getByText("Pot 1,200").waitFor({ timeout: 15_000 });
    expect(await table.getByRole("list", { name: "Board" }).getByRole("listitem").allInnerTexts()).toEqual(["A♠", "10♦", "7♣"]);
    const ada = page.getByRole("group", { name: "ada" });
    expect(await ada.innerText()).toContain("Stack 880");
    expect(await ada.innerText()).toContain("Bet 40");
    expect(await ada.getByRole("listitem").allInnerTexts()).toEqual(["K♥", "Q♥"]);
    await ada.getByLabel("Dealer").waitFor({ timeout: 15_000 });
    const ben = page.getByRole("group", { name: "ben" });
    expect(await ben.getAttribute("aria-current")).toBe("true"); // the turn marker
    expect(await ada.getAttribute("aria-current")).toBeNull();
    expect(await ben.getByLabel("face-down card").count()).toBe(2);
    expect(await page.getByRole("group", { name: "cy" }).innerText()).toContain("Folded");

    d1.say("Raise it is.", "t1");
    await page.getByRole("log", { name: "Transcript" }).getByText("Raise it is.").waitFor({ timeout: 15_000 });
    expect(await page.getByRole("log", { name: "Transcript" }).innerText()).toContain("ada");
    // each plate sits under its own avatar, left to right
    const xs = await Promise.all(["ada", "ben", "cy"].map(async (n) => (await page.getByRole("group", { name: n }).boundingBox())!.x));
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
  });

  it("makes the other seats look at whoever is speaking, and look ahead again when the line ends (VIK-58)", { timeout: 90_000 }, async () => {
    const { page, drivers: [, d2] } = await setup();
    const looks = () => page.evaluate(() => window.__vikaki!.table!.seats.map((s) => s.look));
    d2.say("x".repeat(60), "u1"); // 2.4 s
    await page.waitForFunction(() => window.__vikaki!.table!.seats[0]!.look > 0.1, null, { timeout: 15_000 });
    const [left, middle, right] = await looks();
    expect(left!).toBeGreaterThan(0); // the seat to the speaker's left (screen left) turns toward the right
    expect(right!).toBeLessThan(0);
    expect(middle).toBe(0); // the speaker looks ahead
    await d2.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u1");
    await page.waitForFunction(() => window.__vikaki!.table!.seats.every((s) => Math.abs(s.look) < 0.02), null, { timeout: 15_000 });
  });

  it("shows a silent reaction on its seat only: a feeling for a moment, a shake of the head, and then rest (VIK-58)", { timeout: 90_000 }, async () => {
    const { page, drivers: [, d2] } = await setup();
    await page.evaluate(() => window.__vikaki!.table!.resetPeaks());
    d2.ws.send(JSON.stringify(make("react", { seat_id: "seat-2", emotion: "surprised", gesture: "shake", seconds: 1 })));
    await page.waitForFunction(() => window.__vikaki!.table!.seats[1]!.symbol === "bang", null, { timeout: 15_000 });
    await page.waitForFunction(() => window.__vikaki!.table!.seats[1]!.symbol === null, null, { timeout: 15_000 }); // the whole reaction has played
    const { yawMin, yawMax } = await page.evaluate(() => window.__vikaki!.table!.seats[1]!.peak);
    expect(yawMax - yawMin).toBeGreaterThan(0.08); // the head swung from side to side
    const others = await seatsOf(page);
    expect([others[0]!.symbol, others[2]!.symbol]).toEqual([null, null]); // only that seat reacted
  });

  it("leaves a seat that is thinking, or speaking, as it is: a reaction does not talk over them (VIK-58)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1, , d3] } = await setup();
    d3.send("turn_started");
    await page.waitForFunction(() => window.__vikaki!.table!.seats[2]!.symbol === "dots", null, { timeout: 15_000 });
    d3.ws.send(JSON.stringify(make("react", { seat_id: "seat-3", emotion: "happy", gesture: "nod" })));
    d1.say("x".repeat(60), "u1", { emotion: "smug" });
    await page.waitForFunction(() => window.__vikaki!.table!.seats[0]!.symbol !== null, null, { timeout: 15_000 });
    d1.ws.send(JSON.stringify(make("react", { seat_id: "seat-1", emotion: "sad" })));
    await page.waitForTimeout(600);
    const symbols = (await seatsOf(page)).map((s) => s.symbol);
    expect(symbols[2]).toBe("dots"); // still thinking
    expect(symbols[0]).not.toBe("gloom"); // still the line's own feeling, not the reaction's
  });

  it("plays `vikaki table-demo`'s scripted hand: each seat thinks, then speaks, in turn, on its own avatar", { timeout: 180_000 }, async () => {
    const { page } = await setup("seats=3", { width: 960, height: 540 }, false);
    await page.evaluate(() => window.__vikaki!.table!.resetPeaks()); // the page records who spoke and who showed the thinking dots, on every frame
    const cliDir = fileURLToPath(new URL("../../cli", import.meta.url));
    const cliEntry = join(cliDir, "src/index.ts");
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, "table-demo", "--url", server!.wsUrl, "--pace", "0.25"], { cwd: cliDir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const code = await new Promise<number | null>((ok) => child.once("exit", ok));
    expect(code, out).toBe(0);
    const { spoke, thought } = await page.evaluate(() => {
      const t = window.__vikaki!.table!;
      return { spoke: t.spoke, thought: t.seats.flatMap((s, i) => (s.peak.thought ? [i] : [])) };
    });
    expect(spoke, "who spoke, in order: ada, ben, cy, ada, ben, ada, ben, ada, ben").toEqual([0, 1, 2, 0, 1, 0, 1, 0, 1]);
    expect(thought, "every seat that has a thinking beat was asked to think (the drawn dots are checked by the thinking-turn test: a 250 ms beat can fall between two frames)").toEqual([0, 1, 2]);
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
