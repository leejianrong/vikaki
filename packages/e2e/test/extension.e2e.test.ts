import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fixture = here("../fixtures/vowel-aa.wav");
const meetingHtml = readFileSync(here("../fixtures/meeting.html"));

// Strict enough to block data: URLs for fetch and for scripts, which is how wLipSync loads its WASM and worklet.
const STRICT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'";

let site: Server;
let origin: string;
let context: BrowserContext;

beforeAll(async () => {
  const extDir = mkdtempSync(join(tmpdir(), "vikaki-ext-"));
  execFileSync("node", ["build.mjs", "--out", extDir, "--extra-match", "http://127.0.0.1/*"], {
    cwd: here("../../extension"),
    stdio: "pipe",
  });

  site = createServer((req, res) => {
    const headers: Record<string, string> = { "content-type": "text/html" };
    if (req.url === "/meeting-strict") headers["content-security-policy"] = STRICT_CSP;
    res.writeHead(200, headers).end(meetingHtml);
  });
  await new Promise<void>((ok) => site.listen(0, "127.0.0.1", ok));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "vikaki-profile-")), {
    channel: "chromium", // new headless mode, which can load extensions
    headless: true,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream", // also provides a fake camera, which the extension must never use
      `--use-file-for-fake-audio-capture=${fixture}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
}, 120_000);

afterAll(async () => {
  await context?.close();
  await new Promise((ok) => site?.close(ok));
});

async function joinMeeting(path: string): Promise<{ page: Page; result: Awaited<ReturnType<typeof run>> }> {
  const page = await context.newPage();
  await page.goto(`${origin}${path}`);
  return { page, result: await run(page) };
}

const run = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { join(): Promise<{ devices: { kind: string; label: string }[]; videoLabel: string; videoTracks: number; audioTracks: number; cameraPermission: string }> }).join(),
  );

const ext = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __vikakiExt: Record<string, unknown> }).__vikakiExt }));

/** Min and max of the mouth weight over `ms`. The fake mic loops 1.5 s silence, 2 s "aah", 1.5 s silence. */
const mouthRange = (page: Page, ms: number) =>
  page.evaluate(async (t) => {
    const e = (window as unknown as { __vikakiExt: { mouth: number } }).__vikakiExt;
    let min = Infinity, max = 0;
    const end = performance.now() + t;
    while (performance.now() < end) {
      min = Math.min(min, e.mouth);
      max = Math.max(max, e.mouth);
      await new Promise((r) => setTimeout(r, 50));
    }
    return { min, max };
  }, ms);

describe("meeting extension", () => {
  it("offers the avatar as the only camera and never touches the physical one", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const { page, result } = await joinMeeting("/meeting");
    expect(result.devices.filter((d) => d.kind === "videoinput")).toEqual([{ kind: "videoinput", label: "Vikaki Avatar" }]);
    expect(result.devices.some((d) => d.kind === "audioinput")).toBe(true); // the mic is still there
    expect(result.videoLabel).toBe("Vikaki Avatar");
    expect(result.videoTracks).toBe(1);
    expect(result.audioTracks).toBe(1);
    expect(result.cameraPermission).toBe("granted");
    const state = await ext(page);
    expect(state.physicalCameraRequests).toBe(0);
    expect(state.videoRequestsServed).toBe(1);
    await page.close();
  });

  it("sends real avatar frames, not the fake camera's test pattern", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const { page } = await joinMeeting("/meeting");
    await page.waitForFunction(() => (window as unknown as { __vikakiExt: { avatarReady: boolean } }).__vikakiExt.avatarReady, null, { timeout: 30_000 });
    await page.waitForFunction(() => (window as unknown as { brownShare(): { share: number } }).brownShare().share > 0.08, null, { timeout: 15_000 });
    const { share, width, height, corners } = await page.evaluate(() => (window as unknown as { brownShare(): { share: number; width: number; height: number; corners: number[][] } }).brownShare());
    expect([width, height]).toEqual([1280, 720]);
    expect(share).toBeGreaterThan(0.08); // the gingerbread body fills a good part of the frame
    // The background is a deliberate opaque colour (0xcfe9f5 = 207, 233, 245), not transparent black or white.
    for (const c of corners) {
      expect(c[0]).toBeGreaterThan(195), expect(c[0]).toBeLessThan(220);
      expect(c[1]).toBeGreaterThan(220), expect(c[1]).toBeLessThan(245);
      expect(c[2]).toBeGreaterThan(235), expect(c[2]).toBeLessThanOrEqual(255);
      expect(c[3]).toBe(255);
    }
    await page.close();
  });

  it("lip-syncs from the microphone with wLipSync", async () => {
    const { page } = await joinMeeting("/meeting");
    const { min, max } = await mouthRange(page, 8000);
    const state = await ext(page);
    expect(state.mouthKind).toBe("wlipsync");
    expect(max).toBeGreaterThan(0.3);
    expect(min).toBeLessThan(0.05);
    await page.close();
  }, 60_000);

  it("falls back to an amplitude mouth under a strict page security policy, and still lip-syncs", async () => {
    const { page } = await joinMeeting("/meeting-strict");
    const { min, max } = await mouthRange(page, 8000);
    const state = await ext(page);
    expect(state.mouthKind).toBe("amplitude");
    expect(String(state.mouthReason)).not.toBe("");
    expect(state.avatarReady).toBe(true); // the avatar itself still renders under the policy
    expect(max).toBeGreaterThan(0.3);
    expect(min).toBeLessThan(0.05);
    await page.close();
  }, 60_000);

  it("gives each video request its own track, so stopping one leaves the other running", async () => {
    const { page } = await joinMeeting("/meeting");
    const states = await page.evaluate(async () => {
      const a = await navigator.mediaDevices.getUserMedia({ video: true });
      const b = await navigator.mediaDevices.getUserMedia({ video: true });
      a.getVideoTracks()[0]!.stop();
      return { a: a.getVideoTracks()[0]!.readyState, b: b.getVideoTracks()[0]!.readyState, audioInVideoOnly: a.getAudioTracks().length };
    });
    expect(states).toEqual({ a: "ended", b: "live", audioInVideoOnly: 0 });
    expect((await ext(page)).physicalCameraRequests).toBe(0);
    await page.close();
  }, 60_000);

  it("does nothing on pages it is not allowed on", async () => {
    const page = await context.newPage();
    await page.goto(`${origin.replace("127.0.0.1", "localhost")}/meeting`); // not in the match list
    const result = await run(page);
    expect(result.videoLabel).not.toBe("Vikaki Avatar");
    expect(result.devices.some((d) => d.label === "Vikaki Avatar")).toBe(false);
    await page.close();
  }, 60_000);
});

describe("meeting extension with the camera not allowed", () => {
  let blocked: BrowserContext;

  beforeAll(async () => {
    const extDir = mkdtempSync(join(tmpdir(), "vikaki-ext-"));
    execFileSync("node", ["build.mjs", "--out", extDir, "--extra-match", "http://127.0.0.1/*"], { cwd: here("../../extension"), stdio: "pipe" });
    // No --use-fake-ui-for-media-stream: nobody grants the permission prompt, as with a camera blocked by policy.
    blocked = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "vikaki-profile-")), {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream"],
    });
  }, 120_000);

  afterAll(async () => {
    await blocked?.close();
  });

  const tryCamera = (page: Page) =>
    page.evaluate(async () => {
      const out: { video: string; permission: string } = { video: "", permission: "" };
      try {
        out.video = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0]!.label;
      } catch (e) {
        out.video = `${(e as Error).name}`;
      }
      out.permission = (await navigator.permissions.query({ name: "camera" as PermissionName })).state;
      return out;
    });

  it("is refused on a page the extension is not on, which shows the camera really is blocked", async () => {
    const page = await blocked.newPage();
    await page.goto(`${origin.replace("127.0.0.1", "localhost")}/meeting`);
    expect(await tryCamera(page)).toEqual({ video: "NotAllowedError", permission: "denied" });
    await page.close();
  }, 60_000);

  it("still gets the avatar camera on a page the extension is on", async () => {
    const page = await blocked.newPage();
    await page.goto(`${origin}/meeting`);
    expect(await tryCamera(page)).toEqual({ video: "Vikaki Avatar", permission: "granted" });
    expect((await ext(page)).physicalCameraRequests).toBe(0);
    await page.close();
  }, 60_000);
});
