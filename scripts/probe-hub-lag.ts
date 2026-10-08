// Dev helper: speak once with the real voice and report (a) the timeline events and (b) how long the server's event loop stalls.
// A stall delays everything the hub relays (speech_started to the driver, cancel to the page). Needs `make install-voice` and `pnpm build`.
//   pnpm exec tsx scripts/probe-hub-lag.ts
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findVoice } from "../packages/cli/src/voice.ts";
import { startServer } from "../packages/server/src/server.ts";
import { KokoroTts } from "../packages/tts/src/index.ts";

const tts = await KokoroTts.create({ importFrom: findVoice()!.entry });
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
console.log(`server event-loop delay while speaking: max ${(h.max / 1e6).toFixed(0)} ms, p99 ${(h.percentile(99) / 1e6).toFixed(0)} ms, mean ${(h.mean / 1e6).toFixed(1)} ms`);
await browser.close(); await server.close();
