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
  it("loads the default VRM avatar with no page errors", async () => {
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

  it("opens the mouth on `aa` and changes the rendered frame", async () => {
    const page = await open("?hud=0");
    await page.waitForTimeout(300);
    const closed = await page.screenshot();

    await page.evaluate(() => window.__vikaki!.setVisemes({ aa: 1 }));
    await page.waitForTimeout(300);
    const open_ = await page.screenshot();

    expect(await expressionValue(page, "aa")).toBe(1);
    expect(Buffer.compare(closed, open_)).not.toBe(0);

    await page.evaluate(() => window.__vikaki!.setVisemes({}));
    await page.waitForTimeout(300);
    expect(await expressionValue(page, "aa")).toBe(0);
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
