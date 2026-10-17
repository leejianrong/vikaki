import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { serveHost, unlockHostHtml, type HostPage } from "./host-page.ts";
import { SeatDriver, SEATS } from "./seat-driver.ts";

// The sound gate of an embedded page (VIK-66, ADR-0020). Headless Chromium lets pages make sound with no click at all, so every other test
// here runs with `--autoplay-policy=no-user-gesture-required`. This one does the opposite: it asks for the policy a person's browser has
// (sound needs a click on the page), and checks first that the gate is really shut.
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const avatars = fileURLToPath(new URL("../../engine/public/avatars/", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;
let host: HostPage | undefined;
const pages: Page[] = [];
const drivers: SeatDriver[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=document-user-activation-required"] });
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
 * Until the click, nothing here may count as a user gesture on either page: Playwright's `waitForSelector` does (it unlocked the sound by
 * itself, so the first version of this test saw no lock at all), and so would a context made inside `evaluate`. The state is read from the messages the page posts
 * to the host, logged to the console by the host's listener.
 */
async function setup(o: { allow?: string; parent?: (hostOrigin: string) => string | undefined } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "vikaki-embed-audio-e2e-"));
  await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n`);
  server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 40, chunkMs: 100 }) } });
  const hubOrigin = new URL(server.url).origin;
  host = await serveHost((origin) => {
    const parent = o.parent ? o.parent(origin) : origin;
    return unlockHostHtml(hubOrigin, `${server!.url}?seats=2&embed=1&seed=3${parent ? `&parent=${encodeURIComponent(parent)}` : ""}`, o.allow);
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  pages.push(page);
  const heard: string[] = [];
  let lockedSaid = false;
  page.on("console", (m) => {
    if (m.text().startsWith("HEARD:")) heard.push(m.text().slice(6));
    if (m.text().includes("the browser blocks sound until the page is clicked")) lockedSaid = true; // the page's own note, once it has made its audio context
  });
  await page.goto(host.origin);
  // Found by its address, polling: `page.waitForSelector` counts as a user gesture on the page and would unlock the sound by itself.
  let frame: Frame | undefined;
  for (let i = 0; i < 400 && !frame; i++) {
    frame = page.frames().find((f) => f.url().startsWith(server!.url));
    if (!frame) await new Promise((r) => setTimeout(r, 50));
  }
  if (!frame) throw new Error("the avatar frame never appeared");
  const [d1] = await Promise.all(SEATS.slice(0, 2).map((s) => SeatDriver.connect(server!.wsUrl, s)));
  drivers.push(d1!);
  // Touching the frame before it has made its audio context (even to ask whether something is visible) counts as a gesture and unlocks it. Wait for the note.
  for (let i = 0; i < 600 && !lockedSaid; i++) await new Promise((r) => setTimeout(r, 50));
  if (!lockedSaid) throw new Error("the page never said the browser blocks sound: the gate is not shut, so this test would prove nothing");
  const audio = () => frame.evaluate(() => ({ ...window.__vikaki!.audio! }));
  const waitFor = async (type: string, ms = 15_000) => {
    const end = Date.now() + ms;
    while (!heard.includes(type)) {
      if (Date.now() > end) throw new Error(`the host never heard ${type}; it heard [${heard.join(", ")}]`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return { page, frame, d1: d1!, heard, audio, waitFor };
}

/** Waits for the button to be showing, by asking `isVisible` over and over: Playwright's `locator.waitFor` counts as a gesture and would unlock the sound. */
async function pillShowing(frame: Frame, ms = 15_000): Promise<void> {
  const pill = frame.getByRole("button", { name: "Click for sound" });
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await pill.isVisible()) return;
  throw new Error("the 'Click for sound' button never showed");
}

describe("sound in an embedded page", () => {
  it("is locked until the host sends `unlock` after a click: the page says so, and the next line is heard", { tags: ["smoke"], timeout: 120_000 }, async () => {
    const { page, frame, d1, heard, audio, waitFor } = await setup();
    // The gate is really shut: the page made its audio context, the browser kept it suspended, and the page told the host so.
    await waitFor("audio_locked");
    expect(heard).not.toContain("audio_unlocked");
    await pillShowing(frame);

    // The person clicks on the HOST page. The host sends `unlock` from its click handler.
    await page.click("#go");
    await waitFor("audio_unlocked");
    expect((await audio()).state).toBe("running");
    await frame.getByRole("button", { name: "Click for sound" }).waitFor({ state: "hidden" });

    const before = await audio();
    d1.say("x".repeat(40), "after");
    await d1.waitFor((m) => m.type === "speech_finished" && m.utterance_id === "after");
    const after = await audio();
    expect(after.played).toBeGreaterThan(0); // handed to the speakers
    expect(after.time! - before.time!).toBeGreaterThan(1); // on a clock that is running
  });

  it("a click on the host page alone does not unlock it (that is why the handshake exists)", { timeout: 120_000 }, async () => {
    const { page, heard, waitFor } = await setup();
    await waitFor("audio_locked");
    await page.mouse.click(800, 20); // the host page itself, beside the button: a real click, with no `unlock` sent
    await new Promise((r) => setTimeout(r, 1500));
    expect(heard).not.toContain("audio_unlocked");
  });

  it("needs allow=\"autoplay\" on the iframe: without it the host's click and `unlock` leave the sound locked", { timeout: 120_000 }, async () => {
    const { page, heard, frame, waitFor } = await setup({ allow: "" });
    await waitFor("audio_locked");
    await page.click("#go");
    await new Promise((r) => setTimeout(r, 1500));
    expect(heard).not.toContain("audio_unlocked");
    // the button in the frame is the way out, and a click there works
    await frame.getByRole("button", { name: "Click for sound" }).click();
    await waitFor("audio_unlocked");
  });

  it("says nothing to a host that is not the one named in ?parent=, and ignores its `unlock`", { timeout: 120_000 }, async () => {
    const { page, heard, frame } = await setup({ parent: () => "http://127.0.0.1:9" });
    await pillShowing(frame); // locked, so there is something to say
    await page.click("#go"); // sends `unlock` to the frame, which must not obey
    await new Promise((r) => setTimeout(r, 1500));
    expect(heard).toEqual([]);
    expect(await frame.getByRole("button", { name: "Click for sound" }).isVisible()).toBe(true); // still locked
  });

  it("says nothing when no host is named at all (no ?parent=), though the button still works", { timeout: 120_000 }, async () => {
    const { page, heard, frame } = await setup({ parent: () => undefined });
    await pillShowing(frame);
    await page.click("#go");
    await new Promise((r) => setTimeout(r, 1500));
    expect(heard).toEqual([]);
    await frame.getByRole("button", { name: "Click for sound" }).click();
    await frame.getByRole("button", { name: "Click for sound" }).waitFor({ state: "hidden" });
  });
});
