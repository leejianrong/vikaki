// Dev helper: how visible are blinks when the renderer is slow? usage: node scripts/probe-blink.mjs <url> <cpuThrottle>
import { chromium } from "playwright";
const [url, throttle = "1"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 640, height: 480 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });
await p.goto(`${url}?hud=0&seed=7`);
await p.waitForFunction(() => window.__vikaki?.ready, null, { timeout: 60000 });
const r = await p.evaluate(async () => {
  let max = 0, frames = 0; const t0 = performance.now();
  while (performance.now() - t0 < 6000) { max = Math.max(max, window.__vikaki.blink); frames++; await new Promise((r) => requestAnimationFrame(r)); }
  return { peak: +max.toFixed(2), blinks: window.__vikaki.blinks, fps: +(frames / 6).toFixed(1) };
});
console.log(JSON.stringify(r));
await b.close();
