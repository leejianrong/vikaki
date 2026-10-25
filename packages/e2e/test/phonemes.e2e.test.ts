import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";
import { startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

// Phonemes with times reach the page, behind the hub's --phonemes flag (VIK-50, ADR-0047).
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;
const sockets: WebSocket[] = [];
const pages: Page[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {})));
  await server?.close();
  server = undefined;
});

/** A hub (a fake voice that says what it spoke, with or without the flag), a page on it, and a driver that says one line and waits for its end. */
async function speak(flag: boolean, text: string) {
  server = await startServer({ staticDir, speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 50, phonemes: true }), phonemes: flag } });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  pages.push(page);
  await page.goto(`${server.url}?live=1&hud=0&seed=3`);
  await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.live.soundBlocked === false, null, { timeout: 30_000 });
  const ws = new WebSocket(server.wsUrl);
  sockets.push(ws);
  const seen: string[] = [];
  ws.on("message", (d) => seen.push(JSON.parse(d.toString()).type));
  await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
  ws.send(JSON.stringify(make("hello", { role: "driver" })));
  await new Promise((r) => setTimeout(r, 200));
  ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: "u1", text }));
  const end = Date.now() + 20_000;
  while (!seen.includes("speech_finished")) {
    if (Date.now() > end) throw new Error(`timed out; saw ${seen.join(",")}`);
    await new Promise((r) => setTimeout(r, 30));
  }
  return page;
}

describe("phonemes on the page", () => {
  it("with the flag, the line's phonemes are on the page's clock, in order, and spread across the time the line takes", { timeout: 90_000 }, async () => {
    const page = await speak(true, "Hello there, my friend.");
    const got = await page.evaluate(() => window.__vikaki!.phonemes!.all().map((x) => ({ ...x })));
    expect(got.map((g) => g.p).join("")).toBe("hɛllothɛɹɛmifɹɪɛnd");
    expect(new Set(got.map((g) => g.utteranceId))).toEqual(new Set(["u1"]));
    for (let i = 1; i < got.length; i++) expect(got[i]!.startMs).toBeGreaterThanOrEqual(got[i - 1]!.endMs - 1);
    const span = got.at(-1)!.endMs - got[0]!.startMs;
    expect(span).toBeGreaterThan(700); // 23 characters at 50 ms is 1.15 s of sound
    expect(span).toBeLessThan(1300);
    expect(got.filter((g) => g.stress === 1).length).toBe(4); // one stressed vowel a word
    // `at` finds the sound being spoken at a time inside it
    const mid = got[3]!;
    expect(await page.evaluate((t) => window.__vikaki!.phonemes!.at(t)?.p, (mid.startMs + mid.endMs) / 2)).toBe(mid.p);
  });

  it("without the flag, the page is sent none and holds none", { timeout: 90_000 }, async () => {
    const page = await speak(false, "Hello there.");
    expect(await page.evaluate(() => window.__vikaki!.phonemes!.size)).toBe(0);
  });
});
