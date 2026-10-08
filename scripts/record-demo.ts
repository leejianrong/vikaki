// Dev helper: record the README demo video (silent webm + cue and caption sheets for the video-demo skill's mux step).
//   pnpm exec tsx scripts/record-demo.ts <outdir>      (needs `pnpm build` and the real voice: `make install-voice`)
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findVoice } from "../packages/cli/src/voice.ts";
import { startServer } from "../packages/server/src/server.ts";
import { KokoroTts } from "../packages/tts/src/index.ts";

const out = process.argv[2] ?? "demo-out";
const text = "Good morning, everyone! Shall we begin?";
mkdirSync(out, { recursive: true });
const found = findVoice();
if (!found) throw new Error("the real voice is not installed; run `make install-voice`");
const tts = await KokoroTts.create({ importFrom: found.entry });
const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)), speech: { tts } });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const size = { width: 1280, height: 720 };
const context = await browser.newContext({ colorScheme: "light", viewport: size, recordVideo: { dir: out, size } });
const page = await context.newPage();
const recordingStart = Date.now(); // the video file starts about here
page.on("pageerror", (e) => console.error("page error:", e.message));

const cues: { sfx: string; t: number }[] = [];
const captions: { text: string; start: number; end: number }[] = [];
let started = Date.now();
const now = () => (Date.now() - started) / 1000;
const cue = (sfx: string) => cues.push({ sfx, t: +now().toFixed(2) });
const caption = (text: string, start = now(), length = 3) => captions.push({ text, start: +start.toFixed(2), end: +(start + length).toFixed(2) });

await page.goto(`${server.url}?demo=speech&live=1&seed=7`);
await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.timelineUi, null, { timeout: 60_000 });
started = Date.now(); // the cue clock starts when the page is ready
const lead = (started - recordingStart) / 1000; // how much of the file came before that
await page.waitForTimeout(1800); // idle: the avatar blinks

caption("Type what it should say");
const box = page.getByRole("textbox", { name: "What the avatar should say" });
await box.fill(""); // it starts with a preset line; replace it
await box.click();
cue("click");
await box.pressSequentially(text, { delay: 55 });
await page.waitForTimeout(500);

await page.getByRole("button", { name: "Speak", exact: true }).click();
cue("click");
await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("started:")), null, { timeout: 60_000 });
cue("pop");
caption("Words light up as it speaks", now(), 3.5);
await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("finished:")), null, { timeout: 90_000 });
await page.waitForTimeout(700);

const id = await page.evaluate(() => (window.__vikaki!.timeline as { utterances(): { id: string }[] }).utterances().at(-1)!.id);
await page.evaluate((i) => window.__vikaki!.timelineUi!.select(i), id);
cue("success-chime");
caption("Review it on the timeline", now(), 3);
await page.waitForTimeout(3000);

const total = now();
const video = await page.video()!.path();
await context.close();
await browser.close();
await server.close();
await tts.close?.(); // lets the voice worker finish and exit; without it the process never ends
renameSync(video, `${out}/demo.webm`);
// cues were measured from `started`, after the page loaded; the file began earlier, so shift everything by the lead.
const shift = (t: number) => +(t + lead).toFixed(2);
writeFileSync(`${out}/cues.json`, JSON.stringify(cues.map((c) => ({ ...c, t: shift(c.t) })), null, 2));
writeFileSync(`${out}/captions.json`, JSON.stringify(captions.map((c) => ({ ...c, start: shift(c.start), end: shift(c.end) })), null, 2));
console.log("recorded", `${out}/demo.webm`, "lead", lead.toFixed(1), "s; total", (total + lead).toFixed(1), "s");
