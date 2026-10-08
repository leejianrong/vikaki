// Dev helper: speak once with the real voice and report (a) the timeline events and (b) how long the server's event loop stalls.
// A stall delays everything the hub relays (speech_started to the driver, cancel to the page). Needs `make install-voice` and `pnpm build`.
//   pnpm exec tsx scripts/probe-hub-lag.ts [--in-process]    (--in-process runs Kokoro in the server's own thread, as before KAN-1957)
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findVoice } from "../packages/cli/src/voice.ts";
import { startServer } from "../packages/server/src/server.ts";
import { KokoroTts } from "../packages/tts/src/index.ts";

const tts = await KokoroTts.create({ importFrom: findVoice()!.entry, inProcess: process.argv.includes("--in-process") });
const h = monitorEventLoopDelay({ resolution: 10 });
const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)), speech: { tts } });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(`${server.url}?demo=speech&live=1&seed=7`);
await page.waitForFunction(() => window.__vikaki?.live?.state === "connected", null, { timeout: 60000 });
h.enable();
await page.getByRole("button", { name: "Speak", exact: true }).click();
await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("finished:")), null, { timeout: 90000 });
h.disable();
const ev = await page.evaluate(() => (window.__vikaki!.timeline as { events(): { t: number; kind: string }[] }).events().filter((e) => e.kind !== "blink").map((e) => `${e.kind}@${Math.round(e.t)}`));
console.log(ev.join("  "));
// then cancel a second line while its next sentence is still being made
await page.evaluate(() => { (window.__vikaki!.live!.events as string[]).length = 0; });
await page.getByRole("button", { name: "Speak", exact: true }).click();
await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("started:")), null, { timeout: 90000 });
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await page.waitForFunction(() => (window.__vikaki!.timeline as { events(): { kind: string }[] }).events().some((e) => e.kind === "driver:interrupted"), null, { timeout: 30000 });
const cancelEv = await page.evaluate(() => (window.__vikaki!.timeline as { events(): { t: number; kind: string }[] }).events().filter((e) => ["cancel", "interrupted", "driver:interrupted"].includes(e.kind)).map((e) => `${e.kind}@${Math.round(e.t)}`));
console.log("cancel mid-sentence:", cancelEv.join("  "));
console.log(`server event-loop delay while speaking: max ${(h.max / 1e6).toFixed(0)} ms, p99 ${(h.percentile(99) / 1e6).toFixed(0)} ms, mean ${(h.mean / 1e6).toFixed(1)} ms`);
await browser.close(); await server.close(); await tts.close(); process.exit(0);
