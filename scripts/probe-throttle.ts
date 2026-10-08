// Dev helper: how fast does the avatar page render when the CPU is slowed down (CI has two shared cores)? Compare two builds.
//   pnpm exec tsx scripts/probe-throttle.ts [dist dir] [slowdown, default 6] [url query]
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../packages/server/src/server.ts";

const [dist = "packages/engine/dist", slowdown = "6", query = "?hud=0&seed=3"] = process.argv.slice(2);
const server = await startServer({ staticDir: resolve(dist) });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.goto(`${server.url}${query}`);
await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 60_000 });
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(slowdown) });
const r = (await page.evaluate(`new Promise((done) => {
  const ts = [];
  const tick = (t) => { ts.push(t); if (t - ts[0] < 5000) requestAnimationFrame(tick); else { const d = ts.slice(1).map((x, i) => x - ts[i]); done({ avg: d.reduce((a, b) => a + b, 0) / d.length, frames: d.length }); } };
  requestAnimationFrame(tick);
})`)) as { avg: number; frames: number };
console.log(dist.split("/").slice(-4, -3)[0] || dist, `slowdown ${slowdown}x:`, `avg frame ${r.avg.toFixed(1)} ms (${(1000 / r.avg).toFixed(1)} fps), ${r.frames} frames in 5 s`);
await browser.close();
await server.close();
