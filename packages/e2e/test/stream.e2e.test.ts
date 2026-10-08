import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";
import { HeadlessRenderer, MjpegFeed, startScreencast } from "@vikaki/render";
import { startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

const run = promisify(execFile);
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const cliDir = fileURLToPath(new URL("../../cli", import.meta.url));
const cliEntry = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url));

const hasFfprobe = await run("ffprobe", ["-version"]).then(() => true, () => false);

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
  say(text: string, id: string) {
    this.ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: id, text }));
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

/** What ffprobe says about the first video stream of a URL. */
async function probe(url: string): Promise<{ codec_name: string; width: number; height: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", "-analyzeduration", "3000000", "-probesize", "2000000", url], { timeout: 30_000 });
  return JSON.parse(stdout).streams[0];
}

let browser: Browser;
let decoder: Awaited<ReturnType<Browser["newPage"]>>;
beforeAll(async () => {
  browser = await chromium.launch();
  decoder = await browser.newPage();
});
afterAll(async () => {
  await browser?.close();
});

/** How many pixels differ visibly between two JPEGs (decoded in a browser, since Node has no JPEG decoder here). */
async function pixelsChanged(a: Buffer, b: Buffer): Promise<number> {
  return decoder.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [p, q] = [await load(x!), await load(y!)];
      let n = 0;
      for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i]! - q[i]!) + Math.abs(p[i + 1]! - q[i + 1]!) + Math.abs(p[i + 2]! - q[i + 2]!) > 60) n++;
      return n;
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

let server: RunningServer | undefined;
let renderer: HeadlessRenderer | undefined;
let stopCast: (() => Promise<void>) | undefined;
let feed: MjpegFeed | undefined;
const drivers: Driver[] = [];
afterEach(async () => {
  for (const d of drivers.splice(0)) d.ws.terminate();
  await stopCast?.().catch(() => {});
  stopCast = undefined;
  feed?.close();
  feed = undefined;
  await renderer?.close().catch(() => {});
  renderer = undefined;
  await server?.close();
  server = undefined;
});

async function startFeed(size = { width: 640, height: 360 }) {
  feed = new MjpegFeed({ fps: 15 });
  const f = feed;
  server = await startServer({ staticDir, speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 }) }, routes: { "/stream.mjpg": (q, r) => f.handle(q, r), "/stream.jpg": (q, r) => f.snapshot(q, r) } });
  // `still=1` holds the head at rest, so frames from different moments differ only by what is being said
  renderer = await HeadlessRenderer.launch({ pageUrl: server.url, size, query: { still: "1", bg: "fff1e8", seed: "3" } });
  stopCast = await startScreencast(renderer.pages.get(undefined)!, { ...size, quality: 80 }, (jpeg) => f.push(jpeg));
  const base = server.url.replace(/\/avatar$/, "");
  // wait for the first frame
  for (let i = 0; i < 100 && f.frames === 0; i++) await new Promise((r) => setTimeout(r, 100));
  return { base, driver: await Driver.connect(server.wsUrl).then((d) => (drivers.push(d), d)) };
}

describe("the MJPEG feed", () => {
  it.skipIf(!hasFfprobe)("ffprobe on the URL sees a motion-JPEG video stream at the configured size", { timeout: 120_000 }, async () => {
    const { base } = await startFeed({ width: 640, height: 360 });
    expect(await probe(`${base}/stream.mjpg`)).toMatchObject({ codec_name: "mjpeg", width: 640, height: 360 });
  });

  it("frames change while a line is spoken, and not while it is quiet", { timeout: 120_000 }, async () => {
    const { base, driver } = await startFeed();
    const snap = async () => Buffer.from(await (await fetch(`${base}/stream.jpg`)).arrayBuffer());
    await new Promise((r) => setTimeout(r, 1500));
    const quietA = await snap();
    await new Promise((r) => setTimeout(r, 400));
    const quietB = await snap();
    const quiet = await pixelsChanged(quietA, quietB);
    driver.say("x".repeat(60), "u1"); // 2.4 s of speech
    await driver.waitFor((m) => m.type === "speech_started");
    let most = 0;
    for (let i = 0; i < 12; i++) {
      most = Math.max(most, await pixelsChanged(quietA, await snap()));
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(quiet, "two quiet frames should hardly differ").toBeLessThan(300);
    expect(most, "a frame during speech should show the mouth moving").toBeGreaterThan(quiet + 800);
  });

  it("is an opaque picture in the chosen background colour, not transparent", { timeout: 120_000 }, async () => {
    const { base } = await startFeed();
    const jpeg = Buffer.from(await (await fetch(`${base}/stream.jpg`)).arrayBuffer());
    const corner = await decoder.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      return Array.from(ctx.getImageData(4, 4, 1, 1).data);
    }, jpeg.toString("base64"));
    // fff1e8 is (255, 241, 232); JPEG is lossy, so allow a few levels
    expect(Math.abs(corner[0]! - 255)).toBeLessThan(8);
    expect(Math.abs(corner[1]! - 241)).toBeLessThan(8);
    expect(Math.abs(corner[2]! - 232)).toBeLessThan(8);
  });
});

describe("vikaki stream", () => {
  function start(args: string[], ready: RegExp) {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, "stream", "--tts", "fake", "--static", staticDir, "--port", "0", ...args], { stdio: ["ignore", "pipe", "pipe"], cwd: cliDir });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const exit = new Promise<number | null>((ok) => child.once("exit", ok));
    const up = new Promise<string>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`never ready; out: ${out} err: ${err}`)), 90_000);
      const poll = setInterval(() => ready.test(out) && (clearTimeout(timer), clearInterval(poll), ok(out)), 100);
      exit.then(() => (clearTimeout(timer), clearInterval(poll), fail(new Error(`exited early; out: ${out} err: ${err}`))));
    });
    return { up, exit, stop: () => child.kill("SIGINT"), err: () => err };
  }

  it.skipIf(!hasFfprobe)("publishes a feed at the size and fps asked for, and stops cleanly on Ctrl+C", { timeout: 180_000 }, async () => {
    const proc = start(["--size", "400x400", "--fps", "10"], /stream: http/);
    try {
      const out = await proc.up;
      const url = /stream: (http:\/\/127\.0\.0\.1:\d+\/stream\.mjpg)/.exec(out)![1]!;
      expect(out).toMatch(/400x400, 10 fps/);
      expect(await probe(url)).toMatchObject({ codec_name: "mjpeg", width: 400, height: 400 });
    } finally {
      proc.stop();
    }
    expect(await proc.exit).toBe(0);
  });

  it("requires the token when the server has one", { timeout: 180_000 }, async () => {
    const proc = start(["--token", "s3cret"], /stream: http/);
    try {
      const out = await proc.up;
      const url = /stream: (http:\/\/127\.0\.0\.1:\d+)\/stream\.mjpg/.exec(out)![1]!;
      expect(out).toMatch(/add \?token=/);
      expect((await fetch(`${url}/stream.jpg`)).status).toBe(401);
      expect((await fetch(`${url}/stream.jpg?token=nope`)).status).toBe(401);
      const ok = await fetch(`${url}/stream.jpg?token=s3cret`);
      expect([200, 503]).toContain(ok.status); // 503 only if the very first frame has not come yet
    } finally {
      proc.stop();
    }
    expect(await proc.exit).toBe(0);
  });

  it("rejects a nonsense size, fps, quality or background before starting anything", { timeout: 60_000 }, async () => {
    for (const [flag, value, words] of [["--size", "big", /1280x720/], ["--fps", "0", /1 to 60/], ["--quality", "101", /1 to 100/], ["--background", "purple", /hex digits/]] as const) {
      const proc = start([flag, value], /never/);
      await proc.up.catch(() => {});
      expect(await proc.exit).toBe(1);
      expect(proc.err()).toMatch(words);
    }
  });

  it("will not stream audio-only pages, which draw nothing", { timeout: 60_000 }, async () => {
    const proc = start(["--audio-only"], /never/);
    await proc.up.catch(() => {});
    expect(await proc.exit).toBe(1);
    expect(proc.err()).toMatch(/nothing to stream/);
  });
});
