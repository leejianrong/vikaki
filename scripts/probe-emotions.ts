// Dev helper: screenshot every emotion on the avatar page, to judge the look by eye.
//   pnpm exec tsx scripts/probe-emotions.ts <outdir> [avatar url] [intensity]     (needs `pnpm build`)
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { EMOTIONS } from "../packages/protocol/src/index.ts";
import { startServer } from "../packages/server/src/server.ts";

const [out = "emotions", avatar, intensity = "1"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)) });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${server.url}?hud=0&seed=3${avatar ? `&avatar=${encodeURIComponent(avatar)}` : ""}`);
await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
for (const e of EMOTIONS) {
  await page.evaluate(([name, k]) => window.__vikaki!.setEmotion(name, Number(k)), [e, intensity]);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${out}/${e}.png` });
}
await page.evaluate(() => window.__vikaki!.setThinking(true));
await page.waitForTimeout(1300);
await page.screenshot({ path: `${out}/thinking.png` });
await browser.close();
await server.close();
