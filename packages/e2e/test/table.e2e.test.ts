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
  await page.goto(`${server.url}?${query}${query.includes("director=") ? "" : "&director=off"}&seed=3`); // the camera director is off unless a test asks for it: it would move the camera under every other test
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
    await table.getByText("Pot: 1,200").waitFor({ timeout: 15_000 });
    expect(await table.getByRole("list", { name: "Board" }).getByRole("listitem").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["A♠", "10♦", "7♣"]);
    const ada = page.getByRole("group", { name: "ada", exact: true });
    expect(await ada.innerText()).toContain("Stack 880");
    expect(await ada.innerText()).toContain("Bet 40");
    expect(await ada.getByRole("listitem").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["K♥", "Q♥"]);
    await ada.getByLabel("Dealer").waitFor({ timeout: 15_000 });
    const ben = page.getByRole("group", { name: "ben", exact: true });
    expect(await ben.getAttribute("aria-current")).toBe("true"); // the turn marker
    expect(await ada.getAttribute("aria-current")).toBeNull();
    expect(await ben.getByLabel("face-down card").count()).toBe(2);
    expect(await page.getByRole("group", { name: "cy", exact: true }).innerText()).toContain("Folded");

    d1.say("Raise it is.", "t1");
    await page.getByRole("log", { name: "Transcript" }).getByText("Raise it is.").waitFor({ timeout: 15_000 });
    expect(await page.getByRole("log", { name: "Transcript" }).innerText()).toContain("ada");
    // each plate sits under its own avatar, left to right
    const xs = await Promise.all(["ada", "ben", "cy"].map(async (n) => (await page.getByRole("group", { name: n, exact: true }).boundingBox())!.x));
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

  it("seats every avatar with the thighs running under the table, not away from it (VIK-81)", { timeout: 90_000 }, async () => {
    const { page } = await setup("seats=3&view=table", undefined, false);
    const reach = await page.evaluate(() => window.__vikaki!.table!.seats.map((s) => s.kneeReach));
    // a thigh is about 0.4 m: the knees must be well toward the table's middle from the hips (the bug put them a few tenths the other way)
    for (const r of reach) expect(r).toBeGreaterThan(0.15);
  });

  it("seats the avatars round a 3D table with ?view=table: each plate under its own head, the speaker's mouth, the others' heads turned to look (VIK-62)", { timeout: 90_000 }, async () => {
    const { page, drivers: [, d2] } = await setup("seats=3&view=table");
    expect(await page.evaluate(() => window.__vikaki!.table!.view)).toBe("table");
    const xs = await Promise.all(["ada", "ben", "cy"].map(async (n) => (await page.getByRole("group", { name: n, exact: true }).boundingBox())!.x));
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
    await page.evaluate(() => window.__vikaki!.table!.resetPeaks());
    d2.say("x".repeat(60), "u1");
    await page.waitForFunction(() => window.__vikaki!.table!.seats[0]!.look > 0.1, null, { timeout: 15_000 });
    const looks = await page.evaluate(() => window.__vikaki!.table!.seats.map((s) => s.look));
    expect(looks[0]!).toBeGreaterThan(0); // the left seat turns toward the speaker in the middle
    expect(looks[2]!).toBeLessThan(0);
    expect(looks[1]).toBe(0);
    await d2.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u1");
    const [m1, m2, m3] = await page.evaluate(() => window.__vikaki!.table!.seats.map((s) => s.peak.mouth)); // peaks of every frame since the reset, whenever the line began
    expect(m2).toBeGreaterThan(0.3);
    expect(Math.max(m1!, m3!)).toBeLessThan(0.05);
  });

  it("shows a spectator panel beside the 3D table: pot, board, and per seat the cards, the hand in words, the chance to win as a bar, and what it did (VIK-83)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    d1.ws.send(
      JSON.stringify(
        make("table_state", {
          pot: 48,
          street: "flop",
          board: ["Ks", "8d", "3c"],
          dealer: "seat-1",
          turn: "seat-3",
          seats: [
            { seat_id: "seat-1", stack: 180, bet: 12, cards: ["Kd", "Kc"], hand: "three of a kind, kings", win: 0.91, action: "raised to 12" },
            { seat_id: "seat-2", stack: 188, folded: true, cards: ["back", "back"] },
            { seat_id: "seat-3", stack: 160, bet: 12, cards: ["As", "Ah"], hand: "pair of aces", win: 0.09, action: "called 12" },
          ],
        }),
      ),
    );
    const panel = page.getByRole("complementary", { name: "Table panel" });
    await page.getByRole("region", { name: "Hand" }).getByText("Pot: 48").waitFor();
    expect(await panel.getByRole("list", { name: "Board" }).getByRole("listitem").count()).toBe(3);
    const ada = panel.getByRole("group", { name: "ada, hand" });
    expect(await ada.innerText()).toContain("Stack 180");
    expect(await ada.locator(".hand-name").textContent()).toBe("three of a kind, kings");
    expect(await ada.getByRole("list", { name: "Cards" }).getByRole("listitem").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["K♦", "K♣"]);
    expect(await ada.getByRole("meter", { name: "ada chance to win" }).getAttribute("aria-valuenow")).toBe("91");
    expect(await ada.innerText()).toContain("91%");
    expect(await ada.innerText()).toContain("raised to 12");
    const ben = panel.getByRole("group", { name: "ben, hand" });
    expect(await ben.innerText()).toContain("Folded");
    expect(await ben.getByRole("meter").count()).toBe(0); // a folded seat has no chance to show
    expect(await panel.getByRole("group", { name: "cy, hand" }).getAttribute("aria-current")).toBe("true"); // whose turn it is
    // the panel sits beside the canvas, which the stylesheet sizes (ADR-0012)
    const box = await page.evaluate(() => {
      const c = document.getElementById("stage") as HTMLCanvasElement;
      const a = document.querySelector("aside.table-panel")!.getBoundingClientRect();
      return { canvasRight: c.getBoundingClientRect().right, panelLeft: a.left, inline: c.getAttribute("style") };
    });
    expect(box.canvasRight).toBeLessThanOrEqual(box.panelLeft + 1);
    expect(box.inline ?? "").not.toMatch(/width|height/);
    // the pot strip over the canvas is not drawn twice
    expect(await page.locator(".table-info").isVisible()).toBe(false);
  });

  it("shows what is said in a scrolling Chat in the panel, and a fading bubble over the speaker only; no strip at the bottom (VIK-91)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1, d2] } = await setup("seats=3&view=table");
    const long = "Well now, that is a lot of chips to put in the middle on a flop like this, but fine, I will call and see what you have got. ".repeat(2).trim();
    d1.say(long, "c1");
    const chat = page.getByRole("log", { name: "Chat" });
    await chat.getByText(long).waitFor({ timeout: 15_000 }); // the whole line, not cut off
    expect(await page.locator(".transcript").isVisible()).toBe(false);
    const bubble = page.getByLabel("ada says");
    await bubble.waitFor({ state: "visible" });
    expect(await page.getByLabel("ben says").isVisible()).toBe(false);
    d2.say("Fold.", "c2");
    await page.getByLabel("ben says").waitFor({ state: "visible", timeout: 15_000 });
    expect(await bubble.isVisible()).toBe(false); // only the speaker has one
    await page.getByLabel("ben says").waitFor({ state: "hidden", timeout: 15_000 }); // and it fades
    for (let i = 0; i < 12; i++) d1.say(`Line number ${i}`, `n${i}`);
    await chat.getByText("Line number 11").waitFor({ timeout: 15_000 });
    const m = await chat.evaluate((c) => ({ scrollable: c.scrollHeight > c.clientHeight, atEnd: c.scrollHeight - c.scrollTop - c.clientHeight < 2 }));
    expect(m).toEqual({ scrollable: true, atEnd: true });
  });

  it("shows who a line is for: \"ada → ben\" in the Chat and an arrow in the bubble, and nothing extra for a line to the table (VIK-120)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    d1.say("Nice try, Ben.", "t1", { to: "seat-2" });
    const chat = page.getByRole("log", { name: "Chat" });
    await chat.getByText("Nice try, Ben.").waitFor({ timeout: 15_000 });
    expect(await chat.innerText()).toContain("ada → ben");
    const bubble = page.getByLabel("ada says");
    await bubble.waitFor({ state: "visible" });
    expect(await bubble.innerText()).toContain("→ ben");
    await bubble.waitFor({ state: "hidden", timeout: 15_000 });
    d1.say("Hello everyone.", "t2");
    await chat.getByText("Hello everyone.").waitFor({ timeout: 15_000 });
    const last = await chat.locator("p").last().innerText();
    expect(last).toContain("ada");
    expect(last).not.toContain("→");
  });

  it("shows a private thought in the Thoughts panel, apart from the chat, with a mark over the thinker until its next turn; it is never spoken (VIK-93)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const thought = "Ace-king, and nobody has bet. Time to raise.";
    d1.think(thought);
    const thoughts = page.getByRole("log", { name: "Thoughts" });
    await page.getByRole("tab", { name: "Thoughts" }).click(); // Chat and Thoughts are tabs (VIK-138)
    await thoughts.getByText(thought).waitFor({ timeout: 15_000 });
    expect(await thoughts.innerText()).toContain("ada");
    await page.getByRole("tab", { name: "Chat" }).click();
    expect(await page.getByRole("log", { name: "Chat" }).innerText()).not.toContain(thought); // not table talk
    expect(await page.getByLabel("ben says").isVisible()).toBe(false);
    await page.getByLabel("ada has a thought").waitFor({ state: "visible" });
    expect(await page.getByLabel("ben has a thought").isVisible()).toBe(false);
    d1.send("turn_started");
    await page.getByLabel("ada has a thought").waitFor({ state: "hidden", timeout: 15_000 });
  });

  it("shows a spoken monologue as a thought bubble labelled Thinking and in the Thoughts panel, never in the chat (VIK-121)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const thought = "All in with a pair of nines. Please hold.";
    d1.say(thought, "m1", { thought: true });
    const bubble = page.getByLabel("ada says");
    await bubble.waitFor({ state: "visible", timeout: 15_000 });
    expect(await bubble.innerText()).toContain("Thinking");
    expect(await bubble.getAttribute("class")).toContain("thought");
    await page.getByRole("tab", { name: "Thoughts" }).click();
    await page.getByRole("log", { name: "Thoughts" }).getByText(thought).waitFor({ timeout: 15_000 });
    await page.getByRole("tab", { name: "Chat" }).click();
    expect(await page.getByRole("log", { name: "Chat" }).innerText()).not.toContain(thought);
    d1.say("Hello everyone.", "m2");
    await page.getByRole("log", { name: "Chat" }).getByText("Hello everyone.").waitFor({ timeout: 15_000 });
    expect(await bubble.getAttribute("class")).not.toContain("thought"); // table talk gets the ordinary bubble back
  });

  it("lets the panel be resized by dragging or by keys, keeps the table beside it, and remembers the width; it opens at 45% of the window (VIK-111, VIK-138)", { timeout: 120_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const handle = page.getByRole("separator", { name: "Resize panel" });
    const panel = page.getByRole("complementary", { name: "Table panel" });
    const geometry = () =>
      page.evaluate(() => {
        const c = document.querySelector("canvas")!;
        const a = document.querySelector("aside.table-panel")!.getBoundingClientRect();
        return { panelWidth: Math.round(a.width), canvasRight: c.getBoundingClientRect().right, panelLeft: a.left, inline: c.getAttribute("style") ?? "" };
      });
    const before = await geometry();
    expect(before.panelWidth).toBe(432); // 45% of 960
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    const keyed = await geometry();
    expect(keyed.panelWidth).toBe(532); // +20 and +80
    expect(await handle.getAttribute("aria-valuenow")).toBe("532");
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x - 280, box.y + 200, { steps: 5 });
    await page.mouse.up();
    const dragged = await geometry();
    expect(dragged.panelWidth).toBeGreaterThanOrEqual(640); // 532 + the 280 px dragged, up to the widest it may be (70%)
    expect(dragged.canvasRight).toBeLessThanOrEqual(dragged.panelLeft + 1); // the table makes room: no overlap
    expect(dragged.inline).not.toMatch(/width|height/); // ADR-0012: the stylesheet sizes the canvas
    d1.say("A line for the squeezed table.", "r1");
    await page.getByLabel("ada says").waitFor({ state: "visible", timeout: 15_000 });
    const bubble = (await page.getByLabel("ada says").boundingBox())!;
    expect(bubble.x).toBeGreaterThanOrEqual(0); // the bubble is not cut off at the stage's edge
    await page.reload();
    await page.getByRole("separator", { name: "Resize panel" }).waitFor();
    expect((await geometry()).panelWidth).toBe(dragged.panelWidth); // remembered
    await page.getByRole("separator", { name: "Resize panel" }).dblclick();
    expect((await geometry()).panelWidth).toBe(432);
    await page.getByRole("separator", { name: "Resize panel" }).focus();
    await page.keyboard.press("Home");
    expect((await geometry()).panelWidth).toBe(280);
  });

  it("acts each decision with the seat's hands: a knock for a check, a push for a call or raise, a toss for a fold (VIK-137)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const seats = [{ seat_id: "seat-1", stack: 94 }, { seat_id: "seat-2", stack: 94 }, { seat_id: "seat-3", stack: 94 }];
    const send = (event: { kind: string; seat_id: string; text: string; amount?: number }) => d1.ws.send(JSON.stringify(make("table_state", { pot: 6, street: "flop", seats, event })));
    send({ kind: "check", seat_id: "seat-1", text: "Ada checks" });
    send({ kind: "raise", seat_id: "seat-2", amount: 12, text: "Ben raises to 12" });
    send({ kind: "fold", seat_id: "seat-3", text: "Cy folds" });
    send({ kind: "street", seat_id: "seat-3", text: "Turn" }); // a title card is no decision
    await page.waitForFunction(() => window.__vikaki!.table!.acted.length >= 3, null, { timeout: 15_000 });
    const acted = await page.evaluate(() => window.__vikaki!.table!.acted);
    expect(acted).toEqual([
      { seat: "seat-1", act: "knock", how: "arms" },
      { seat: "seat-2", act: "push", how: "arms" },
      { seat: "seat-3", act: "toss", how: "arms" },
    ]);
  });

  it("lays the table out as a top bar, a players strip, an activity log with hand separators, and Chat and Thoughts as tabs (VIK-138)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table", { width: 1280, height: 720 });
    const seats = [{ seat_id: "seat-1", stack: 94 }, { seat_id: "seat-2", stack: 94 }, { seat_id: "seat-3", stack: 94 }];
    const send = (extra: object) => d1.ws.send(JSON.stringify(make("table_state", { seats, ...extra })));
    send({ hand_no: 3, street: "preflop", pot: 3, event: { kind: "new_hand", text: "Hand 3", detail: "Blinds 1/2 · Ada deals" } });
    send({ hand_no: 3, street: "preflop", pot: 15, event: { kind: "raise", seat_id: "seat-1", amount: 12, text: "Ada raises to 12" } });
    send({ hand_no: 3, street: "flop", pot: 18, board: ["As", "Kd", "2c"], event: { kind: "street", text: "Flop" } });
    const bar = page.getByRole("region", { name: "Hand" });
    await bar.getByText("Hand 3").waitFor({ timeout: 15_000 });
    await bar.getByText("Blinds 1/2 · Ada deals").waitFor();
    await bar.getByText("Pot: 18").waitFor();
    const log = page.getByRole("log", { name: "Activity" });
    await log.getByText("Flop: A♠ K♦ 2♣").waitFor({ timeout: 15_000 });
    expect(await log.innerText()).toMatch(/Hand 3[\s\S]*Ada raises to 12[\s\S]*Flop/);
    expect(await page.getByRole("complementary", { name: "Table panel" }).evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(576); // 45% of 1280
    // Chat is open, Thoughts is not; the tab opens it and the dot says something new arrived while it was shut
    expect(await page.getByRole("log", { name: "Thoughts" }).isVisible()).toBe(false);
    d1.think("Ace-king. Raise.");
    await page.getByRole("tab", { name: "Thoughts" }).locator(".new-dot").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByRole("tab", { name: "Thoughts" }).click();
    await page.getByRole("log", { name: "Thoughts" }).getByText("Ace-king. Raise.").waitFor();
    expect(await page.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("false");
  });

  it("draws the cards in the classic look only when asked: ?cards=classic puts a picture of each face in the panel, and the default stays clean (VIK-115)", { timeout: 120_000 }, async () => {
    const seats = [{ seat_id: "seat-1", stack: 94, cards: ["Ah", "Kd"] }, { seat_id: "seat-2", stack: 94 }, { seat_id: "seat-3", stack: 94 }];
    const state = { pot: 18, street: "flop", board: ["As", "Kd", "10c"], seats };
    for (const [query, pictures] of [["seats=3&view=table&cards=classic", 5], ["seats=3&view=table", 0]] as const) {
      const { page, drivers: [d1] } = await setup(query);
      d1.ws.send(JSON.stringify(make("table_state", state)));
      const panel = page.getByRole("complementary", { name: "Table panel" });
      await panel.getByRole("list", { name: "Board" }).getByRole("listitem").first().waitFor({ timeout: 15_000 });
      expect(await panel.getByRole("listitem", { name: "10♣" }).count()).toBe(1); // a card keeps its name either way
      expect(await panel.locator(".card img").count()).toBe(pictures);
      await page.close();
      pages.splice(pages.indexOf(page), 1);
    }
  });

  it("lets the audience listen in to one seat's thoughts: its plate is spotlit, the others dim, only its thoughts are voiced, and a thought never moves the mouth (VIK-98)", { timeout: 120_000 }, async () => {
    const { page, drivers: [d1, d2] } = await setup("seats=3&view=table");
    const played = () => page.evaluate(() => window.__vikaki!.audio!.played);
    // by default every seat's thoughts are voiced, and the mouth stays still for them
    await page.evaluate(() => window.__vikaki!.table!.resetPeaks());
    const before = await played();
    d1.say("Please hold. Please hold.", "t1", { thought: true });
    await page.getByLabel("ada says").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForFunction((n) => window.__vikaki!.audio!.played > n, before, { timeout: 15_000 });
    await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("finished:t1")), null, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__vikaki!.table!.seats[0]!.peak.mouth)).toBeLessThan(0.05); // a thought does not move the mouth
    // listening in to ben: his button is pressed, his plate is spotlit and ada's dims
    await page.getByRole("button", { name: "Listen in to ben" }).click();
    await page.waitForFunction(() => window.__vikaki!.table!.listen.mode === "seat", null, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__vikaki!.table!.listen.seat)).toBe("seat-2");
    expect(await page.getByRole("button", { name: "Listen in to ben" }).getAttribute("aria-pressed")).toBe("true");
    expect(await page.getByRole("group", { name: "ben", exact: true }).evaluate((e) => e.classList.contains("spotlit"))).toBe(true);
    expect(await page.getByRole("group", { name: "ada", exact: true }).evaluate((e) => e.classList.contains("dim"))).toBe(true);
    // ada's thought is no longer voiced (it still shows as text), ben's is
    const quiet = await played();
    d1.say("Ada thinks quietly.", "t2", { thought: true });
    await page.getByRole("tab", { name: "Thoughts" }).click();
    await page.getByRole("log", { name: "Thoughts" }).getByText("Ada thinks quietly.").waitFor({ timeout: 15_000 });
    await new Promise((r) => setTimeout(r, 1500));
    expect(await played()).toBe(quiet);
    d2.say("Ben thinks aloud.", "t3", { thought: true });
    await page.waitForFunction((n) => window.__vikaki!.audio!.played > n, quiet, { timeout: 15_000 });
    // a second click stops listening; the switch brings every seat back
    await page.getByRole("button", { name: "Listen in to ben" }).click();
    await page.waitForFunction(() => window.__vikaki!.table!.listen.mode === "off", null, { timeout: 15_000 });
    await page.getByRole("switch", { name: "Hear every thought" }).click();
    await page.waitForFunction(() => window.__vikaki!.table!.listen.mode === "all", null, { timeout: 15_000 });
    // clicking a plate listens in too
    await page.getByRole("group", { name: "cy", exact: true }).click();
    await page.waitForFunction(() => window.__vikaki!.table!.listen.seat === "seat-3", null, { timeout: 15_000 });
  });

  it("shows the players' cards and odds as a hole-cam graphic that can float over the 3D view, and stays findable by role and name (VIK-97)", { timeout: 120_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table", { width: 1280, height: 720 });
    d1.ws.send(JSON.stringify(make("table_state", { pot: 40, street: "turn", board: ["As", "Kd", "2c", "9h"], seats: [{ seat_id: "seat-1", stack: 80, cards: ["Ah", "Qc"], hand: "pair of aces", win: 0.62 }, { seat_id: "seat-2", stack: 80, cards: ["back", "back"] }, { seat_id: "seat-3", stack: 80, cards: ["Kc", "Jd"], hand: "pair of kings", win: 0.38 }] })));
    const ada = page.getByRole("group", { name: "ada, hand" });
    await ada.getByText("pair of aces").waitFor({ timeout: 15_000 });
    expect(await page.getByRole("meter", { name: "ada chance to win" }).getAttribute("aria-valuenow")).toBe("62");
    const strip = page.getByRole("region", { name: "Players" });
    const inPanel = (await strip.boundingBox())!;
    const panelLeft = (await page.getByRole("complementary", { name: "Table panel" }).boundingBox())!.x;
    expect(inPanel.x).toBeGreaterThanOrEqual(panelLeft); // in the panel
    await page.getByRole("switch", { name: "Hole cams over the table" }).click();
    await page.waitForFunction(() => document.body.classList.contains("holecam-float"));
    const floating = (await strip.boundingBox())!;
    expect(floating.x + floating.width).toBeLessThanOrEqual(panelLeft + 1); // over the stage, not the panel
    await ada.getByText("pair of aces").waitFor(); // still there by role and name
    expect(await page.getByRole("meter", { name: "ada chance to win" }).getAttribute("aria-valuenow")).toBe("62");
    expect(await page.evaluate(() => document.querySelector("canvas")!.getAttribute("style") ?? "")).not.toMatch(/width|height/);
  });

  it("has camera shots: wide, overhead and a close-up of each player, by button, key or ?camera=, gliding between them and never changing the canvas's own size (VIK-95)", { timeout: 120_000 }, async () => {
    const { page } = await setup("seats=3&view=table");
    const cam = () => page.evaluate(() => window.__vikaki!.table!.camera!);
    // the page reports the camera once a frame, so wait for the shot it names and for it to have stopped, not for "not moving" alone
    const arrived = (shot: string) => page.waitForFunction((n) => window.__vikaki!.table!.camera!.shot === n && window.__vikaki!.table!.camera!.moving === false, shot, { timeout: 30_000 });
    const wide = await cam();
    expect(wide.shot).toBe("wide");
    await page.getByRole("button", { name: "Close-up of ben (4)" }).click();
    await page.waitForFunction(() => window.__vikaki!.table!.camera!.moving === true, null, { timeout: 15_000 });
    // it glides: a frame in the middle is neither where it began nor where it ends
    const mid = await cam();
    await arrived("seat:1");
    const close = await cam();
    expect(close.shot).toBe("seat:1");
    expect(Math.hypot(...close.position.map((v, i) => v - wide.position[i]!))).toBeGreaterThan(1);
    expect(mid.position.some((v, i) => Math.abs(v - wide.position[i]!) > 1e-6 || Math.abs(v - close.position[i]!) > 1e-6)).toBe(true);
    expect(await page.getByRole("button", { name: "Close-up of ben (4)" }).getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("2"); // a key for the overhead shot
    await arrived("overhead");
    expect((await cam()).shot).toBe("overhead");
    expect((await cam()).position[1]).toBeGreaterThan(wide.position[1]! + 1);
    await page.getByRole("button", { name: "Wide shot (1)" }).click();
    await arrived("wide");
    const back = await cam();
    expect(back.position.every((v, i) => Math.abs(v - wide.position[i]!) < 1e-6)).toBe(true); // back exactly where it began
    expect(await page.evaluate(() => document.querySelector("canvas")!.getAttribute("style") ?? "")).not.toMatch(/width|height/); // ADR-0012
    await page.close();
    pages.splice(pages.indexOf(page), 1);
    const second = await setup("seats=3&view=table&camera=overhead");
    expect((await second.page.evaluate(() => window.__vikaki!.table!.camera!)).shot).toBe("overhead");
  });

  it("cuts the camera by itself: the board on a street, the winner at the end, and a person's own choice quiets it (VIK-96)", { timeout: 120_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table&director=on");
    const seats = [{ seat_id: "seat-1", stack: 94 }, { seat_id: "seat-2", stack: 94 }, { seat_id: "seat-3", stack: 94 }];
    const send = (extra: object) => d1.ws.send(JSON.stringify(make("table_state", { pot: 18, hand_no: 1, seats, ...extra })));
    const shot = () => page.evaluate(() => window.__vikaki!.table!.camera!.shot);
    const is = (name: string) => page.waitForFunction((n) => window.__vikaki!.table!.camera!.shot === n, name, { timeout: 30_000 });
    expect(await page.getByRole("button", { name: "Auto director (D)" }).getAttribute("aria-pressed")).toBe("true");
    send({ street: "flop", board: ["As", "Kd", "2c"], event: { kind: "street", text: "Flop" } });
    await is("board");
    await new Promise((r) => setTimeout(r, 1500)); // a more important moment may cut after a short minimum
    send({ street: "complete", pot: 0, event: { kind: "win", seat_id: "seat-2", amount: 36, text: "Ben wins 36" }, winners: [{ seat_id: "seat-2", amount: 36 }] });
    await is("seat:1");
    await is("wide"); // held a few seconds, then back to the table
    await page.getByRole("button", { name: "Overhead shot (2)" }).click(); // a person's choice
    await is("overhead");
    send({ street: "turn", board: ["As", "Kd", "2c", "9h"], event: { kind: "street", text: "Turn" } });
    await new Promise((r) => setTimeout(r, 2500));
    expect(await shot()).toBe("overhead"); // the director kept out of the way
    await page.getByRole("button", { name: "Auto director (D)" }).click();
    expect(await page.getByRole("button", { name: "Auto director (D)" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("announces each beat of a hand in a banner: a move fades, a win stays until the next beat, and the actor's plate pulses (VIK-113)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const send = (event: { kind: string; text: string; seat_id?: string; amount?: number }, extra: object = {}) =>
      d1.ws.send(JSON.stringify(make("table_state", { pot: 6, street: "flop", seats: [{ seat_id: "seat-1", stack: 94 }, { seat_id: "seat-2", stack: 94 }, { seat_id: "seat-3", stack: 94 }], event, ...extra })));
    const banner = page.getByRole("status", { name: "Last move" });
    send({ kind: "raise", seat_id: "seat-2", amount: 12, text: "Ben raises to 12" });
    await banner.getByText("Ben raises to 12").waitFor({ timeout: 15_000 });
    expect(await page.getByRole("group", { name: "ben", exact: true }).evaluate((e) => e.classList.contains("acted"))).toBe(true);
    await banner.waitFor({ state: "hidden", timeout: 15_000 }); // a move's banner fades
    send({ kind: "win", seat_id: "seat-1", amount: 40, text: "Ada wins 40 with a pair of aces" }, { street: "showdown", pot: 0, winners: [{ seat_id: "seat-1", amount: 40, hand: "pair of aces" }] });
    await banner.getByText("Ada wins 40 with a pair of aces").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(3000); // longer than any move's banner
    expect(await banner.isVisible()).toBe(true); // the win stays
    send({ kind: "new_hand", text: "Hand 2" }, { street: "preflop", hand_no: 2 });
    await banner.getByText("Hand 2").waitFor({ timeout: 15_000 });
  });

  it("has the panel by default in the 3D view only: not in the row, not when embedded, and ?panel= decides (VIK-83)", { timeout: 120_000 }, async () => {
    const row = await setup("seats=3", undefined, false);
    expect(await row.page.locator("aside.table-panel").count()).toBe(0);
    await row.page.close();
    const off = await setup("seats=3&view=table&panel=0", undefined, false);
    expect(await off.page.locator("aside.table-panel").count()).toBe(0);
    await off.page.close();
    const embedded = await setup("seats=3&view=table&embed=1", undefined, false);
    expect(await embedded.page.locator("aside.table-panel").count()).toBe(0);
    await embedded.page.close();
    const forced = await setup("seats=3&panel=1", undefined, false);
    expect(await forced.page.locator("aside.table-panel").count()).toBe(1);
  });

  it("puts table_state on the 3D table: the board and each seat's cards, chips, and the dealer button; a folded seat's cards go (VIK-62)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const state = (seat3: Record<string, unknown>) =>
      d1.ws.send(
        JSON.stringify(
          make("table_state", {
            pot: 130,
            board: ["As", "Td", "7c"],
            dealer: "seat-1",
            seats: [
              { seat_id: "seat-1", stack: 880, bet: 40, cards: ["Kh", "Qh"] },
              { seat_id: "seat-2", stack: 940, cards: ["back", "back"] },
              { seat_id: "seat-3", stack: 60, cards: ["back", "back"], ...seat3 },
            ],
          }),
        ),
      );
    state({});
    await page.waitForFunction(() => window.__vikaki!.table!.props!.boardCards === 3, null, { timeout: 15_000 });
    const props = () => page.evaluate(() => ({ ...window.__vikaki!.table!.props! }));
    expect(await props()).toMatchObject({ boardCards: 3, seatCards: [2, 2, 2], dealer: "seat-1", pot: "Pot: 130", handsFaceUp: false }); // the pot has a label; hands stay face down
    expect((await props()).chips).toBeGreaterThan(20);
    state({ folded: true });
    await page.waitForFunction(() => window.__vikaki!.table!.props!.seatCards[2] === 0, null, { timeout: 15_000 });
    expect((await props()).seatCards).toEqual([2, 2, 0]);
  });

  it("flips a new board card over before it counts as drawn, shows a title card with its detail, and lights the five cards of the winning hand (VIK-114, VIK-94)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const seats = (cards: string[]) => ["seat-1", "seat-2", "seat-3"].map((seat_id) => ({ seat_id, stack: 90, cards }));
    const send = (o: Record<string, unknown>) => d1.ws.send(JSON.stringify(make("table_state", { dealer: "seat-1", hand_no: 1, ...o } as never)));
    send({ pot: 6, street: "flop", board: ["As", "Td", "7c"], seats: seats(["back", "back"]) });
    await page.waitForFunction(() => window.__vikaki!.table!.props!.boardCards === 3, null, { timeout: 15_000 });
    await page.evaluate(() => {
      const seen = new Set<number>();
      (window as unknown as { __seen: Set<number> }).__seen = seen;
      const tick = () => (seen.add(window.__vikaki!.table!.props!.boardCards), requestAnimationFrame(tick));
      tick();
    });
    await page.evaluate(() => (window as unknown as { __seen: Set<number> }).__seen.clear());
    send({ pot: 6, street: "turn", board: ["As", "Td", "7c", "2h"], seats: seats(["back", "back"]) });
    await page.waitForFunction(() => window.__vikaki!.table!.props!.boardCards === 4, null, { timeout: 15_000 });
    expect(await page.evaluate(() => [...(window as unknown as { __seen: Set<number> }).__seen].sort())).toEqual([3, 4]); // 3 while the new card turns, then 4: no jump
    send({ pot: 0, street: "showdown", board: ["As", "Td", "7c", "2h", "9d"], seats: seats(["Ah", "Ad"]), winners: [{ seat_id: "seat-1", amount: 12, hand: "pair of aces", best: ["Ah", "Ad", "Td", "9d", "7c"] }], event: { kind: "win", text: "Seat-1 wins 12" } });
    await page.waitForFunction(() => window.__vikaki!.table!.props!.highlighted === 5, null, { timeout: 15_000 }); // the new river card and the hands turn over first, then three board cards and the two in hand are lit
    send({ pot: 3, street: "preflop", board: [], seats: seats(["back", "back"]), hand_no: 2, event: { kind: "new_hand", text: "Hand 2", detail: "Blinds 1/2 · Ada deals" } });
    await page.getByRole("status").getByText("Blinds 1/2 · Ada deals").waitFor({ timeout: 15_000 });
    expect(await page.getByRole("status").innerText()).toContain("Hand 2");
  });

  it("makes the sound effects the table's motion calls for, with a mute switch and a volume slider that are remembered (VIK-122)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const send = (o: Record<string, unknown>) => d1.ws.send(JSON.stringify(make("table_state", { dealer: "seat-1", hand_no: 1, ...o } as never)));
    const seats = (a: number, bet?: number) => ["seat-1", "seat-2", "seat-3"].map((seat_id, i) => ({ seat_id, stack: i === 0 ? a : 90, ...(i === 0 && bet ? { bet } : {}), cards: ["back", "back"] }));
    const cues = () => page.evaluate(() => [...window.__vikaki!.table!.sfx!.cues]);
    send({ pot: 6, street: "preflop", seats: seats(90) });
    await page.waitForFunction(() => window.__vikaki!.table!.props!.seatCards[0] === 2, null, { timeout: 15_000 });
    expect(await cues()).toEqual([]); // the first state this page sees makes no sound
    send({ pot: 18, street: "preflop", seats: seats(78, 12) });
    await page.waitForFunction(() => window.__vikaki!.table!.sfx!.cues.includes("chips"), null, { timeout: 15_000 });
    const group = page.getByRole("group", { name: "Sound effects" });
    const mute = group.getByRole("switch", { name: "Mute sound effects" });
    await mute.check();
    const before = (await cues()).length;
    send({ pot: 30, street: "preflop", seats: seats(66, 24) });
    await page.waitForTimeout(800);
    expect((await cues()).length).toBe(before); // muted: nothing asked for
    await group.getByRole("slider", { name: "Sound effects volume" }).fill("30");
    await page.reload();
    await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
    expect(await page.evaluate(() => [window.__vikaki!.table!.sfx!.muted, window.__vikaki!.table!.sfx!.volume])).toEqual([true, 0.3]);
    expect(await page.getByRole("switch", { name: "Mute sound effects" }).isChecked()).toBe(true);
  });

  it("has the others look at the player who has just acted while the move sits on screen, then look away (VIK-134)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const looks = () => page.evaluate(() => window.__vikaki!.table!.seats.map((s) => Math.abs(s.look)));
    d1.ws.send(JSON.stringify(make("table_state", { pot: 30, street: "flop", hand_no: 1, event: { kind: "raise", seat_id: "seat-1", amount: 24, text: "Ada raises to 24" }, seats: ["seat-1", "seat-2", "seat-3"].map((seat_id) => ({ seat_id, stack: 90 })) } as never)));
    await page.waitForFunction(() => window.__vikaki!.table!.seats[1]!.look !== 0 && window.__vikaki!.table!.seats[2]!.look !== 0, null, { timeout: 15_000 });
    expect((await looks())[0]).toBe(0); // the player who acted looks ahead
    await page.waitForFunction(() => window.__vikaki!.table!.seats.every((s) => Math.abs(s.look) < 0.02), null, { timeout: 15_000 }); // and the gaze moves on
  });

  it("shows playback controls when the game can be paused: pause and play go to the game, stepping back reviews an earlier state, and play returns to live (VIK-135)", { timeout: 90_000 }, async () => {
    const { page, drivers: [d1] } = await setup("seats=3&view=table");
    const bar = page.getByRole("toolbar", { name: "Playback" });
    expect(await bar.isVisible()).toBe(false); // a game that cannot be paused gets no bar
    const state = (pot: number) => d1.ws.send(JSON.stringify(make("table_state", { pot, street: "flop", hand_no: 1, board: ["As", "Kd", "2c"], seats: ["seat-1", "seat-2", "seat-3"].map((seat_id) => ({ seat_id, stack: 90 })) } as never)));
    d1.ws.send(JSON.stringify(make("transport_state", { paused: false } as never)));
    await bar.waitFor({ state: "visible", timeout: 15_000 });
    expect(await bar.getByRole("status").innerText()).toBe("Live");
    await bar.getByRole("button", { name: "Pause" }).click();
    await d1.waitFor((m) => m.type === "transport" && m.action === "pause");
    await bar.getByRole("button", { name: "Play" }).waitFor();
    for (const pot of [10, 20, 30]) state(pot);
    await page.getByRole("region", { name: "Hand" }).getByText("Pot: 30").waitFor({ timeout: 15_000 });
    await bar.getByRole("button", { name: "Step back" }).click();
    await page.getByRole("region", { name: "Hand" }).getByText("Pot: 20").waitFor({ timeout: 15_000 });
    expect(await bar.getByRole("status").innerText()).toBe("Reviewing 2 of 3");
    state(40); // a new state while reviewing is held back
    await page.waitForFunction(() => window.__vikaki!.table!.transport!.length === 4, null, { timeout: 15_000 });
    expect(await page.getByRole("region", { name: "Hand" }).innerText()).toContain("Pot: 20");
    await bar.getByRole("button", { name: "Play" }).click();
    await d1.waitFor((m) => m.type === "transport" && m.action === "play");
    await page.getByRole("region", { name: "Hand" }).getByText("Pot: 40").waitFor({ timeout: 15_000 });
    expect(await bar.getByRole("status").innerText()).toBe("Live");
    await bar.getByRole("button", { name: "Pause" }).click();
    await bar.getByRole("button", { name: "Step forward" }).click();
    await d1.waitFor((m) => m.type === "transport" && m.action === "step");
  });

  it("stays on the row when the view is anything but table", { timeout: 90_000 }, async () => {
    const { page } = await setup("seats=3&view=nonsense");
    expect(await page.evaluate(() => window.__vikaki!.table!.view)).toBe("row");
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
