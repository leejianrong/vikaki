import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { serveHost, unlockHostHtml, type HostPage } from "./host-page.ts";
import { SeatDriver, SEATS } from "./seat-driver.ts";

// Speech events for the framing page (VIK-67): the page tells its host how each line goes, to the host it was told about and nobody else.
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const avatars = fileURLToPath(new URL("../../engine/public/avatars/", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;
let host: HostPage | undefined;
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
  await host?.close();
  await server?.close();
  host = server = undefined;
});

type Heard = { type: string; utterance_id?: string; seat_id?: string; reason?: string };

async function setup(parent: (hostOrigin: string) => string | undefined = (o) => o, firstChunkDelayMs = 0) {
  const dir = await mkdtemp(join(tmpdir(), "vikaki-embed-events-e2e-"));
  await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n`);
  server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100, firstChunkDelayMs }) } });
  const hubOrigin = new URL(server.url).origin;
  host = await serveHost((origin) => {
    const p = parent(origin);
    return unlockHostHtml(hubOrigin, `${server!.url}?seats=2&embed=1&seed=3${p ? `&parent=${encodeURIComponent(p)}` : ""}`);
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  pages.push(page);
  const heard: Heard[] = [];
  page.on("console", (m) => m.text().startsWith("MSG:") && heard.push(JSON.parse(m.text().slice(4))));
  await page.goto(host.origin);
  let frame = undefined as Awaited<ReturnType<Page["frames"]>>[number] | undefined;
  for (let i = 0; i < 400 && !frame; i++) {
    frame = page.frames().find((f) => f.url().startsWith(server!.url));
    if (!frame) await new Promise((r) => setTimeout(r, 50));
  }
  await frame!.waitForFunction(() => window.__vikaki?.ready === true && window.__vikaki.live?.state === "connected", null, { timeout: 40_000 });
  const ds = await Promise.all(SEATS.slice(0, 2).map((s) => SeatDriver.connect(server!.wsUrl, s)));
  drivers.push(...ds);
  const speechOnly = () => heard.filter((m) => m.type.startsWith("speech_"));
  return { page, heard, speechOnly, d1: ds[0]!, d2: ds[1]! };
}
const until = async (check: () => boolean, what: string, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error(`timed out waiting for ${what}`);
};

describe("speech events for the framing page", () => {
  it("receives speech_started and speech_finished for a spoken line, with the utterance and the seat", { tags: ["smoke"], timeout: 120_000 }, async () => {
    const { speechOnly, d2 } = await setup();
    d2.say("x".repeat(20), "hello");
    await until(() => speechOnly().some((m) => m.type === "speech_finished"), "speech_finished");
    expect(speechOnly()).toEqual([
      { type: "speech_started", utterance_id: "hello", seat_id: "seat-2" },
      { type: "speech_finished", utterance_id: "hello", seat_id: "seat-2" },
    ]);
  });

  it("receives speech_interrupted, with the reason and the seat, for a line cut off while it is heard", { timeout: 120_000 }, async () => {
    const { speechOnly, d1 } = await setup();
    d1.say("x".repeat(80), "long"); // 3.2 s
    await until(() => speechOnly().some((m) => m.type === "speech_started"), "speech_started");
    d1.ws.send(JSON.stringify({ protocol_version: 1, type: "cancel", utterance_id: "long" }));
    await until(() => speechOnly().some((m) => m.type === "speech_interrupted"), "speech_interrupted");
    expect(speechOnly()).toEqual([
      { type: "speech_started", utterance_id: "long", seat_id: "seat-1" },
      { type: "speech_interrupted", utterance_id: "long", seat_id: "seat-1", reason: "cancelled" },
    ]);
  });

  it("tells the host about both seats' lines, in order", { timeout: 120_000 }, async () => {
    const { speechOnly, d1, d2 } = await setup();
    d1.say("x".repeat(10), "a");
    await d1.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "a");
    d2.say("x".repeat(10), "b");
    await d2.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "b");
    await until(() => speechOnly().length === 4, "four events");
    expect(speechOnly().map((m) => `${m.type}:${m.utterance_id}:${m.seat_id}`)).toEqual(["speech_started:a:seat-1", "speech_finished:a:seat-1", "speech_started:b:seat-2", "speech_finished:b:seat-2"]);
  });

  it("sends nothing to a host that is not the one the page was told about, or when it was told about none", { timeout: 120_000 }, async () => {
    for (const parent of [() => "http://127.0.0.1:9", () => undefined]) {
      const { d1, heard } = await setup(parent);
      d1.say("x".repeat(10), "quiet");
      await d1.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "quiet"); // the line was heard by the page and reported to the hub
      await new Promise((r) => setTimeout(r, 500));
      expect(heard).toEqual([]);
      await pages.pop()!.close();
      for (const d of drivers.splice(0)) d.ws.terminate();
      await host?.close();
      await server?.close();
      host = server = undefined;
    }
  });

  it("a seat driver that cancels its own line hears speech_interrupted straight away, whether the page is playing it or the voice is still making it", { timeout: 120_000 }, async () => {
    // playing: the page reports it
    const playing = await setup();
    playing.d1.say("x".repeat(80), "playing");
    await until(() => playing.speechOnly().some((m) => m.type === "speech_started"), "speech_started");
    const t0 = Date.now();
    playing.d1.ws.send(JSON.stringify({ protocol_version: 1, type: "cancel", utterance_id: "playing" }));
    await playing.d1.waitFor((m) => m.type === "speech_interrupted" && m.utterance_id === "playing");
    expect(Date.now() - t0).toBeLessThan(process.env.CI ? 2000 : 500);
    for (const d of drivers.splice(0)) d.ws.terminate();
    await pages.pop()!.close();
    await host?.close();
    await server?.close();
    host = server = undefined;
    // synthesising: the hub answers (a 4 s voice, a cancel after 300 ms)
    const making = await setup((o) => o, 4000);
    making.d1.say("x".repeat(20), "making");
    await new Promise((r) => setTimeout(r, 300));
    const t1 = Date.now();
    making.d1.ws.send(JSON.stringify({ protocol_version: 1, type: "cancel", utterance_id: "making" }));
    await making.d1.waitFor((m) => m.type === "speech_interrupted" && m.utterance_id === "making");
    expect(Date.now() - t1).toBeLessThan(process.env.CI ? 2000 : 500); // not the 4 s the voice needs
    expect(making.speechOnly()).toEqual([]); // the page never heard of it, so says nothing to its host
  });
});
