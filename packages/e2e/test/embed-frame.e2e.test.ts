import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer, type VikakiServerOptions } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { frameHtml, serveHost, type HostPage } from "./host-page.ts";
import { SeatDriver, SEATS } from "./seat-driver.ts";
import { Client } from "../../server/test/helpers.ts";

// Who may frame the avatar page (VIK-65, ADR-0021): a game page on another port embeds /avatar and the avatar connects and speaks; a page
// the list does not name is refused by the browser.
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

/**
 * A hub, and a host page on another port framing it. `frameAncestors` may name the host's own origin (a function of it), `hubUrl` changes
 * how the page reaches the hub (localhost instead of 127.0.0.1), `hostName` is the name the host page is served under.
 */
async function embed(o: { frameAncestors?: (hostOrigin: string) => string[] | undefined; hubUrl?: (url: string) => string; hostName?: string; hub?: VikakiServerOptions["hub"]; parent?: boolean | ((hostOrigin: string) => string) } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "vikaki-frame-e2e-"));
  await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n`);
  host = await serveHost((origin) => frameHtml(`${(o.hubUrl ?? ((u: string) => u))(server!.url)}?seats=2&embed=1&seed=3${o.parent === false ? "" : `&parent=${encodeURIComponent(typeof o.parent === "function" ? o.parent(origin) : origin)}`}`), o.hostName ?? "127.0.0.1");
  server = await startServer({
    staticDir,
    personas: await loadPersonas(join(dir, "personas.yaml")),
    speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 }) },
    frameAncestors: o.frameAncestors?.(host.origin),
    hub: o.hub,
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  pages.push(page);
  const console_: string[] = [];
  page.on("console", (m) => console_.push(m.text()));
  await page.goto(host.origin);
  return { page, console: console_ };
}
/** The console line a browser writes when a page's frame-ancestors turns a frame away (the wording differs between versions). */
const blocked = (l: string) => /(Refused to frame|Framing) .*(violates|because an ancestor violates).*frame-ancestors/s.test(l);
const avatarFrame = async (page: Page): Promise<Frame> => {
  for (let i = 0; i < 400; i++) {
    const f = page.frames().find((x) => x !== page.mainFrame());
    if (f) return f;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("no frame");
};
const connected = (f: Frame) => f.waitForFunction(() => window.__vikaki?.ready === true && window.__vikaki.live?.state === "connected", null, { timeout: 40_000 });

/** Two seat drivers say a line each and the page reports having played them (silently: no click needed for that). */
async function speaks(f: Frame) {
  const [d1] = await Promise.all(SEATS.slice(0, 2).map((s) => SeatDriver.connect(server!.wsUrl, s)));
  drivers.push(d1!);
  d1!.say("x".repeat(25), "hello");
  await d1!.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "hello");
  expect(await f.evaluate(() => window.__vikaki!.live!.events)).toEqual(["started:hello", "finished:hello"]);
  expect(await f.evaluate(() => window.__vikaki!.table!.spoke)).toEqual([0]); // seat-1's mouth moved
}

describe("framing the avatar page from another origin", () => {
  it("works by default from a page on another localhost port: the avatar connects and speaks", { tags: ["smoke"], timeout: 120_000 }, async () => {
    const { page } = await embed();
    const f = await avatarFrame(page);
    await connected(f);
    await speaks(f);
  });

  it("works from a page served as `localhost` to a hub reached as `localhost` (a browser on Windows with the hub in WSL)", { timeout: 120_000 }, async () => {
    const { page } = await embed({ hostName: "localhost", hubUrl: (u) => u.replace("127.0.0.1", "localhost") });
    const f = await avatarFrame(page);
    await connected(f);
    await speaks(f);
  });

  it("works from a configured origin, and needs no token: the page is a viewer", { timeout: 120_000 }, async () => {
    const { page } = await embed({ frameAncestors: (o) => [o], hub: { token: "s3cret" } });
    const f = await avatarFrame(page);
    await connected(f);
    // a driver does need it
    const ws = await Client.join(server!.wsUrl, "driver", {}); // no token
    const reply = await ws.next();
    expect(reply).toMatchObject({ type: "error", code: "unauthorized" });
    ws.ws.terminate();
  });

  it("is refused by the browser for a page the list does not name: nothing loads, and nothing connects to the hub", { timeout: 120_000 }, async () => {
    const { page, console: log } = await embed({ frameAncestors: () => ["http://127.0.0.1:1"], parent: false });
    await new Promise((r) => setTimeout(r, 2500)); // the frame has had its chance
    const f = await avatarFrame(page);
    expect(await f.evaluate(() => typeof (window as unknown as { __vikaki?: unknown }).__vikaki).catch(() => "unreachable")).not.toBe("object");
    expect(f.url()).toBe("chrome-error://chromewebdata/"); // the browser put its error page in the frame
    expect(log.some(blocked)).toBe(true);
    expect(server!.hub.viewerCount).toBe(0);
  });

  for (const [name, list] of [["none", []], ["a list that names other origins only (so the default does not leak in)", ["https://game.example"]]] as const) {
    it(`is refused for ${name}`, { timeout: 120_000 }, async () => {
      const { console: log } = await embed({ frameAncestors: () => [...list], parent: false });
      await new Promise((r) => setTimeout(r, 2000));
      expect(log.some(blocked)).toBe(true);
      expect(server!.hub.viewerCount).toBe(0);
    });
  }

  it("refuses to serve a page whose ?parent= names an origin the list does not, with the fix in the message", { timeout: 120_000 }, async () => {
    // the host may frame it (it is in the list), but the page is told its parent is somebody else
    const { page } = await embed({ frameAncestors: (o) => [o], parent: () => "https://evil.example" });
    const f = await avatarFrame(page);
    await f.waitForFunction(() => document.body.innerText.includes("is not an allowed frame ancestor"), null, { timeout: 15_000 });
    expect(await f.evaluate(() => document.body.innerText)).toContain("--frame-ancestors https://evil.example");
  });
});
