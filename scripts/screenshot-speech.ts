// Dev helper: speak through the speech demo and screenshot the page, live and reviewing the utterance, light and dark.
//   pnpm exec tsx scripts/screenshot-speech.ts <outdir> [fake|kokoro] ["text to say"]     (needs `pnpm build`)
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findVoice } from "../packages/cli/src/voice.ts";
import { startServer } from "../packages/server/src/server.ts";
import { FakeTts, KokoroTts, type Tts } from "../packages/tts/src/index.ts";

const [out = "shots", engine = "fake", text = "Good morning, everyone. Shall we begin? Oh, you really think so?"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const found = engine === "kokoro" ? findVoice() : undefined;
if (engine === "kokoro" && !found) throw new Error("the real voice is not installed; run `make install-voice`");
const tts: Tts = engine === "kokoro" ? await KokoroTts.create({ importFrom: found!.entry }) : new FakeTts();
const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)), speech: { tts } });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
for (const scheme of ["light", "dark"] as const) {
  const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${server.url}?demo=speech&live=1&seed=7`);
  await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.timelineUi, null, { timeout: 60_000 });
  await page.getByRole("textbox", { name: "What the avatar should say" }).fill(text);
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("started:")), null, { timeout: 60_000 });
  await page.waitForTimeout(2500); // mid-speech
  await page.screenshot({ path: `${out}/${engine}-${scheme}-live.png` });
  await page.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("finished:")), null, { timeout: 90_000 });
  const id = await page.evaluate(() => (window.__vikaki!.timeline as { utterances(): { id: string }[] }).utterances().at(-1)!.id);
  await page.evaluate((i) => window.__vikaki!.timelineUi!.select(i), id);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${engine}-${scheme}-review.png` });
  if (scheme === "light") {
    const png = await page.evaluate(() => window.__vikaki!.timelineUi!.exportPng());
    (await import("node:fs")).writeFileSync(`${out}/${engine}-export.png`, Buffer.from(png.split(",")[1]!, "base64"));
  }
  await context.close();
}
await browser.close();
await server.close();
console.log("wrote", out);
