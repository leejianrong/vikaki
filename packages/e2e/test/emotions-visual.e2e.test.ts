import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMOTIONS } from "@vikaki/protocol";
import { startServer, type RunningServer } from "@vikaki/server";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

let server: RunningServer;
let browser: Browser;
beforeAll(async () => {
  server = await startServer({ staticDir });
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/** The canvas as pixels (RGBA). */
const pixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.getElementById("stage") as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = 240;
    copy.height = 200;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0, 240, 200);
    return Array.from(ctx.getImageData(0, 0, 240, 200).data);
  });

/** A picture once the face has settled: taken twice 100 ms apart, and retaken if they differ (a blink in progress, a pose still easing). */
async function settled(page: Page): Promise<number[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const first = await pixels(page);
    await page.waitForTimeout(100);
    const second = await pixels(page);
    if (changed(first, second) < 20) return second;
    await page.waitForTimeout(300);
  }
  throw new Error("the picture never settled");
}

/** How many pixels differ visibly between two pictures. */
function changed(a: number[], b: number[]): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 60) n++;
  return n;
}

describe("what each emotion draws", () => {
  it("every emotion looks different from neutral on screen, and more so at full strength than at a third", { timeout: 90_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
    // `still=1` holds the head at rest, so any difference between pictures is the emotion.
    await page.goto(`${server.url}?hud=0&seed=3&still=1`);
    await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
    const set = async (emotion: string, intensity: number) => {
      await page.evaluate(([e, k]) => window.__vikaki!.setEmotion(e as string, k as number), [emotion, intensity] as const);
      await page.waitForTimeout(1300); // the face eases in
    };
    await set("neutral", 1);
    const neutral = await settled(page); // neutral stands still
    // Some emotions move on purpose (happy bounces, worried and angry tremble), so take three pictures and use the middle change:
    // that also ignores a blink that happens to land in one of them.
    const change = async (emotion: string, intensity: number) => {
      await set(emotion, intensity);
      const counts: number[] = [];
      for (let i = 0; i < 3; i++) {
        counts.push(changed(neutral, await pixels(page)));
        await page.waitForTimeout(150);
      }
      return counts.sort((a, b) => a - b)[1]!;
    };
    const small: Record<string, number> = {};
    const full: Record<string, number> = {};
    for (const emotion of EMOTIONS.filter((e) => e !== "neutral")) {
      small[emotion] = await change(emotion, 0.33);
      full[emotion] = await change(emotion, 1);
    }
    for (const emotion of Object.keys(full)) {
      expect(full[emotion], `${emotion} at full strength should visibly change the picture`).toBeGreaterThan(1500);
      expect(full[emotion], `${emotion}: stronger should change more than weaker (${small[emotion]} vs ${full[emotion]})`).toBeGreaterThan(small[emotion]!);
    }
    await page.close();
  });

  it("a made-up emotion draws exactly what neutral draws", { timeout: 60_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
    await page.goto(`${server.url}?hud=0&seed=3&still=1`);
    await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
    const settle = async () => {
      await page.waitForTimeout(1300);
      return settled(page);
    };
    const neutral = await settle();
    await page.evaluate(() => window.__vikaki!.setEmotion("blorp", 1));
    expect(changed(neutral, await settle())).toBeLessThan(50); // sway is a pixel or two
    await page.close();
  });
});
