import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "@vikaki/server";

// Software WebGL so this runs with no GPU (CI, containers).
const CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

let server: RunningServer;
let browser: Browser;
const pageErrors: string[] = [];

async function open(query = ""): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${server.url}${query}`);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
  return page;
}

/** Wait for `n` animation frames to be drawn, so a change has reached the screen. Event-based, not a fixed sleep. */
const framesRendered = (page: Page, n: number) =>
  page.evaluate((count) => new Promise<void>((done) => { let left = count; const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);

const expressionValue = (page: Page, name: string) =>
  page.evaluate((n) => {
    const a = window.__vikaki!.avatar as unknown as { vrm: { expressionManager: { getValue(n: string): number } } };
    return a.vrm.expressionManager.getValue(n);
  }, name);

beforeAll(async () => {
  server = await startServer({ staticDir });
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("avatar page", () => {
  it("loads the default VRM avatar with no page errors", { tags: ["smoke"] }, async () => {
    const page = await open();
    expect(pageErrors).toEqual([]);
    await page.close();
  });

  it("exposes all five mouth shapes and blink on the avatar", async () => {
    const page = await open();
    for (const name of ["aa", "ih", "ou", "ee", "oh", "blink"]) {
      expect(await expressionValue(page, name)).toBe(0);
    }
    await page.close();
  });

  it("opens the mouth on `aa` and changes the rendered frame", { tags: ["smoke"] }, async () => {
    const page = await open("?hud=0");
    await framesRendered(page, 3);
    const closed = await page.screenshot();

    await page.evaluate(() => window.__vikaki!.setVisemes({ aa: 1 }));
    await framesRendered(page, 3);
    const open_ = await page.screenshot();

    expect(await expressionValue(page, "aa")).toBe(1);
    expect(Buffer.compare(closed, open_)).not.toBe(0);

    await page.evaluate(() => window.__vikaki!.setVisemes({}));
    await framesRendered(page, 3);
    expect(await expressionValue(page, "aa")).toBe(0);
    await page.close();
  });

  it("reports what the avatar actually displays, and it follows the mouth shape that was set", { tags: ["smoke"] }, async () => {
    const page = await open("?demo=1&seed=7");
    await page.evaluate(() => window.__vikaki!.setVisemes({ aa: 0.5 }));
    await framesRendered(page, 3);
    const shown = await page.evaluate(() => window.__vikaki!.applied);
    expect(shown.aa).toBeCloseTo(0.5, 2);
    expect(shown.ou).toBeCloseTo(0, 2);
    await page.close();
  });

  it("reads the applied mouth from the morph targets, not from the weight that was set", async () => {
    const page = await open("?demo=1&seed=7");
    const read = await page.evaluate(() => {
      const avatar = window.__vikaki!.avatar as unknown as {
        vrm: { expressionManager: { getExpression(n: string): { binds: { primitives: { morphTargetInfluences: number[] }[]; index: number; weight: number }[] } } };
        appliedVisemes(): Record<string, number>;
      };
      const bind = avatar.vrm.expressionManager.getExpression("aa").binds[0]!;
      bind.primitives[0]!.morphTargetInfluences[bind.index] = 0.3 * bind.weight; // as if a blend had pulled the mouth to 0.3
      return avatar.appliedVisemes().aa;
    });
    expect(read).toBeCloseTo(0.3, 3);
    await page.close();
  });

  it("clamps viseme weights to [0, 1]", async () => {
    const page = await open();
    await page.evaluate(() => window.__vikaki!.setVisemes({ aa: 5, oh: -3 }));
    expect(await expressionValue(page, "aa")).toBe(1);
    expect(await expressionValue(page, "oh")).toBe(0);
    await page.close();
  });

  it("blinks at least twice in 10 seconds of silence", async () => {
    const page = await open("?hud=0&seed=7");
    await page.waitForTimeout(10_000);
    expect(await page.evaluate(() => window.__vikaki!.blinks)).toBeGreaterThanOrEqual(2);
    await page.close();
  });

  it("closes the eyes during a blink", async () => {
    const page = await open("?hud=0&seed=7");
    const peak = await page.evaluate(async () => {
      let max = 0;
      const end = performance.now() + 6000;
      while (performance.now() < end) {
        max = Math.max(max, window.__vikaki!.blink);
        await new Promise((r) => requestAnimationFrame(r));
      }
      return max;
    });
    expect(peak).toBeGreaterThan(0.9);
    expect(await expressionValue(page, "blink")).toBeLessThanOrEqual(1);
    await page.close();
  });

  it("hides the status line with ?hud=0", async () => {
    const page = await open("?hud=0");
    expect(await page.locator("#hud").isHidden()).toBe(true);
    await page.close();
  });
});
