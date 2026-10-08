import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

let browser: Browser;
let server: RunningServer;
beforeAll(async () => {
  server = await startServer({ staticDir, speech: { tts: new FakeTts() } });
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const pages = [
  ["the demo page", "?demo=1&seed=7"],
  ["the speech demo", "?demo=speech&live=1&seed=7"],
] as const;

describe("accessibility (axe)", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const [name, query] of pages) {
      it(`${name} in ${scheme} mode has no axe violations`, async () => {
        const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1200, height: 720 } });
        const page = await context.newPage();
        await page.goto(server.url + query);
        await page.waitForSelector(".md-top-bar, #demo, #speech, canvas", { timeout: 30_000 });
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const report = result.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join("\n  ")}`);
        await context.close();
        expect(report, report.join("\n")).toEqual([]);
      }, 60_000);
    }
  }

  for (const scheme of ["light", "dark"] as const) {
    it(`the speech demo with a spoken line under review (timeline, selector, data table) in ${scheme} mode has no axe violations`, async () => {
      const own = await startServer({ staticDir, speech: { tts: new FakeTts() } }); // its own hub, so tests cannot affect each other
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1200, height: 800 } });
      const page = await context.newPage();
      await page.goto(`${own.url}?demo=speech&live=1&seed=7`);
      const speak = page.getByRole("button", { name: "Speak", exact: true });
      await expect.poll(() => speak.isEnabled(), { timeout: 30_000 }).toBe(true);
      await page.getByRole("textbox", { name: "What the avatar should say" }).fill("Hello there. How are you?");
      await speak.click();
      await page.waitForFunction(() => document.getElementById("log")!.innerText.includes("speech finished"), null, { timeout: 30_000 });
      await page.evaluate(() => window.__vikaki!.timelineUi!.select("demo-1"));
      await page.locator("#timeline details summary").click(); // open the data table
      await expect.poll(() => page.locator("#timeline tbody tr").count()).toBe(2);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const report = result.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join("\n  ")}`);
      await context.close();
      await own.close();
      expect(report, report.join("\n")).toEqual([]);
    }, 90_000);
  }
});
