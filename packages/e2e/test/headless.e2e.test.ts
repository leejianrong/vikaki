import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";
import { HeadlessRenderer } from "@vikaki/render";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const avatars = fileURLToPath(new URL("../../engine/public/avatars/", import.meta.url));
const cliEntry = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url));

type Msg = Record<string, unknown> & { type: string; utterance_id?: string };

class Driver {
  readonly events: Msg[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => this.events.push(JSON.parse(d.toString())));
  }
  static async connect(url: string): Promise<Driver> {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
    ws.send(JSON.stringify(make("hello", { role: "driver" })));
    const d = new Driver(ws);
    await d.waitFor((m) => m.type === "welcome");
    return d;
  }
  say(text: string, id: string, persona?: string) {
    this.ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: id, text, ...(persona ? { persona } : {}) }));
  }
  async waitFor(pred: (m: Msg) => boolean, ms = 60_000): Promise<Msg> {
    const end = Date.now() + ms;
    for (;;) {
      const hit = this.events.find(pred);
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`timed out; saw ${this.events.map((e) => e.type).join(",")}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

let server: RunningServer | undefined;
let renderer: HeadlessRenderer | undefined;
const drivers: Driver[] = [];
afterEach(async () => {
  for (const d of drivers.splice(0)) d.ws.terminate();
  await renderer?.close().catch(() => {});
  renderer = undefined;
  await server?.close();
  server = undefined;
});

const fakeVoice = () => new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 });

describe("headless rendering", () => {
  it("renders a line for real with no one at a screen: the driver hears timings from a page that drew frames", { timeout: 120_000 }, async () => {
    server = await startServer({ staticDir, speech: { tts: fakeVoice() } });
    renderer = await HeadlessRenderer.launch({ pageUrl: server.url });
    expect(server.hub.viewerCount).toBe(1);
    const driver = await Driver.connect(server.wsUrl);
    drivers.push(driver);
    driver.say("x".repeat(40), "u1");
    const finished = await driver.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "u1");
    // `frame_ms` is the first rendered frame with the mouth open: only a page that drew can report it
    expect((finished.timing as { frame_ms?: number }).frame_ms).toEqual(expect.any(Number));
    const png = await renderer.pages.get(undefined)!.screenshot();
    expect(png.length).toBeGreaterThan(5000); // an avatar, not a blank frame
  });

  it("opens one page per persona, each playing its own lines", { timeout: 120_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-headless-"));
    await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n    voice: af_heart\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n    voice: am_adam\n`);
    server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: fakeVoice() } });
    renderer = await HeadlessRenderer.launch({ pageUrl: server.url, personas: ["ada", "ben"] });
    expect([...renderer.pages.keys()]).toEqual(["ada", "ben"]);
    const driver = await Driver.connect(server.wsUrl);
    drivers.push(driver);
    driver.say("Hello from ben.", "u1", "ben");
    await driver.waitFor((m) => m.type === "speech_finished");
    const events = (persona: string) => renderer!.pages.get(persona)!.evaluate(() => window.__vikaki!.live!.events);
    expect(await events("ben")).toEqual(["started:u1", "finished:u1"]);
    expect(await events("ada")).toEqual([]);
  });

  it("opens audio-only pages that draw nothing but still play and report", { timeout: 120_000 }, async () => {
    server = await startServer({ staticDir, speech: { tts: fakeVoice() } });
    renderer = await HeadlessRenderer.launch({ pageUrl: server.url, audioOnly: true });
    const driver = await Driver.connect(server.wsUrl);
    drivers.push(driver);
    driver.say("Hello.", "u1");
    const finished = await driver.waitFor((m) => m.type === "speech_finished");
    expect((finished.timing as { frame_ms?: number }).frame_ms).toBeUndefined();
    expect(await renderer.pages.get(undefined)!.evaluate(() => window.__vikaki!.audioOnly)).toBe(true);
  });

  it("lets go cleanly: closing it removes its pages from the hub", { timeout: 120_000 }, async () => {
    server = await startServer({ staticDir, speech: { tts: fakeVoice() } });
    renderer = await HeadlessRenderer.launch({ pageUrl: server.url });
    expect(server.hub.viewerCount).toBe(1);
    await renderer.close();
    renderer = undefined;
    const end = Date.now() + 5000;
    while (server.hub.viewerCount > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    expect(server.hub.viewerCount).toBe(0);
  });
});

describe("vikaki serve --headless", () => {
  /** Run the CLI; resolves with what it printed once `ready` matches, and a way to stop it. */
  function run(args: string[], ready: RegExp) {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, "serve", "--tts", "fake", "--static", staticDir, "--port", "0", ...args], { stdio: ["ignore", "pipe", "pipe"], cwd: fileURLToPath(new URL("../../cli", import.meta.url)) });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const exit = new Promise<number | null>((ok) => child.once("exit", ok));
    const up = new Promise<string>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`never ready; out: ${out} err: ${err}`)), 90_000);
      const poll = setInterval(() => {
        if (ready.test(out)) (clearTimeout(timer), clearInterval(poll), ok(out));
      }, 100);
      exit.then(() => (clearTimeout(timer), clearInterval(poll), fail(new Error(`exited early; out: ${out} err: ${err}`))));
    });
    return { up, exit, stop: () => child.kill("SIGINT"), err: () => err, child };
  }

  it("starts a hidden browser, renders a line for a driver, and stops everything on Ctrl+C", { timeout: 180_000 }, async () => {
    const proc = run(["--headless"], /headless: rendering/);
    try {
      const out = await proc.up;
      const url = /serving (http:\/\/127\.0\.0\.1:\d+)/.exec(out)![1]!;
      const driver = await Driver.connect(url.replace("http", "ws") + "/ws");
      drivers.push(driver);
      driver.say("x".repeat(40), "u1");
      const finished = await driver.waitFor((m) => m.type === "speech_finished");
      expect((finished.timing as { frame_ms?: number }).frame_ms).toEqual(expect.any(Number)); // a real page drew it
    } finally {
      proc.stop();
    }
    expect(await proc.exit).toBe(0);
  });

  it("explains how to fix it, and exits 1, when there is no browser to render with", { timeout: 60_000 }, async () => {
    const proc = run(["--headless", "--chrome", "/definitely/not/a/browser"], /never-printed/);
    await proc.up.catch(() => {}); // it exits early, which is the point
    expect(await proc.exit).toBe(1);
    expect(proc.err()).toMatch(/cannot start the headless renderer/);
    expect(proc.err()).toMatch(/\/definitely\/not\/a\/browser/);
  });
});
