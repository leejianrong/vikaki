// Dev helper: print mouth openness over time with the synthetic vowel as a fake mic.
// usage: node scripts/probe-mic.mjs <avatar-url> [seconds]
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
const fixture = fileURLToPath(new URL("../packages/e2e/fixtures/vowel-aa.wav", import.meta.url));
const [url, secs = "6"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${fixture}`] });
const p = await b.newPage();
await p.goto(`${url}?mode=mic&hud=0`);
await p.waitForFunction(() => window.__vikaki?.mic === "listening", null, { timeout: 30000 });
const rows = await p.evaluate(async (s) => {
  const out = []; const t0 = performance.now();
  while (performance.now() - t0 < s * 1000) {
    const v = window.__vikaki.visemes; const [k, w] = Object.entries(v).sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
    out.push([+((performance.now() - t0) / 1000).toFixed(2), k, +w.toFixed(2)]);
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}, Number(secs));
console.log(rows.map((r) => r.join(" ")).join("\n"));
await b.close();
