// Dev helper: find the longest main-thread task in the first speech of the speech demo and what is inside it.
//   pnpm exec tsx scripts/probe-trace.ts [dist dir]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../packages/server/src/server.ts";
import { FakeTts } from "../packages/tts/src/index.ts";

const [dist = "packages/engine/dist"] = process.argv.slice(2);
const server = await startServer({ staticDir: resolve(dist), speech: { tts: new FakeTts() } });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(`${server.url}?demo=speech&live=1&seed=7`);
await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.timelineUi, null, { timeout: 60_000 });
const file = "/tmp/claude-1000/-home-jian-projects-abang-ai-vikaki/3950ae89-188d-460d-bd0a-66d51c082978/scratchpad/trace.json";
await browser.startTracing(page, { path: file, categories: ["devtools.timeline", "v8.execute", "disabled-by-default-devtools.timeline"] });
await page.getByRole("button", { name: "Speak", exact: true }).click();
await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("finished:")), null, { timeout: 60_000 });
await browser.stopTracing();
await browser.close();
await server.close();

type Ev = { name: string; ph: string; ts: number; dur?: number; tid: number; pid: number; args?: Record<string, unknown> };
const events = (JSON.parse(readFileSync(file, "utf8")) as { traceEvents: Ev[] }).traceEvents.filter((e) => e.ph === "X" && e.dur);
const tasks = events.filter((e) => e.name === "RunTask").sort((a, b) => b.dur! - a.dur!).slice(0, 3);
for (const t of tasks) {
  console.log(`\nRunTask ${(t.dur! / 1000).toFixed(0)} ms (thread ${t.tid})`);
  const inside = events.filter((e) => e.tid === t.tid && e.pid === t.pid && e.ts >= t.ts && e.ts + e.dur! <= t.ts + t.dur! && e !== t && e.name !== "RunTask");
  const agg = new Map<string, number>();
  for (const e of inside) {
    const fn = (e.args?.data as { functionName?: string; url?: string } | undefined);
    const key = e.name + (fn?.functionName ? ` ${fn.functionName}` : "") + (fn?.url ? ` ${fn.url.split("/").pop()}` : "");
    agg.set(key, Math.max(agg.get(key) ?? 0, e.dur! / 1000));
  }
  for (const [k, ms] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${ms.toFixed(0).padStart(5)} ms  ${k}`);
}
