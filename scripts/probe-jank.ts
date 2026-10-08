// Dev helper: how late does a 50 ms timer fire on the speech demo while it speaks? Compare two builds.
//   pnpm exec tsx scripts/probe-jank.ts [dist dir] [runs]
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../packages/server/src/server.ts";
import { FakeTts } from "../packages/tts/src/index.ts";

const [dist = "packages/engine/dist", runs = "3"] = process.argv.slice(2);
const server = await startServer({ staticDir: resolve(dist), speech: { tts: new FakeTts() } });
const launch = () => chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const worst: number[] = [];
for (let i = 0; i < Number(runs); i++) {
  const browser = await launch(); // a fresh browser each time: the first speech in a browser is the one that stutters
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(`${server.url}?demo=speech&live=1&seed=7`);
  await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.timelineUi, null, { timeout: 60_000 });
  await page.evaluate(`window.__gaps = []; window.__t0 = performance.now(); let last = performance.now(); setInterval(() => { const n = performance.now(); window.__gaps.push([n - window.__t0, n - last]); last = n; }, 50);`);
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await page.evaluate("window.__click = performance.now() - window.__t0");
  await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("finished:")), null, { timeout: 60_000 });
  const all = (await page.evaluate("window.__gaps")) as [number, number][];
  const click = (await page.evaluate("window.__click")) as number;
  const big = all.filter(([, g]) => g > 150).map(([t, g]) => `${Math.round(t - click)}ms:+${Math.round(g)}`);
  if (process.env.SHOW) console.log("  gaps >150 ms (time since click: length):", big.join("  "));
  worst.push(Math.round(Math.max(...all.map(([, g]) => g))));
  await browser.close();
}
console.log(dist.split("/").slice(-3, -2)[0], "worst gap in the first speech of a fresh browser (ms):", worst.join(" "));
await server.close();
