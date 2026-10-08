// Dev helper: two pages (ada and ben) on one hub, ada speaking happily while ben thinks, side by side in one picture.
//   pnpm exec tsx scripts/screenshot-personas.ts <out.png>      (needs `pnpm build`; uses the fake voice)
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { make, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { loadPersonas, startServer } from "../packages/server/src/server.ts";
import { FakeTts } from "../packages/tts/src/index.ts";

const out = process.argv[2] ?? "personas.png";
const avatars = fileURLToPath(new URL("../packages/engine/public/avatars/", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "vikaki-personas-shot-"));
await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n    voice: af_heart\n    emotion: happy\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n    voice: am_adam\n`);
const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)), personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: new FakeTts() } });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const shots: Buffer[] = [];
const pages = [];
for (const p of ["ada", "ben"]) {
  const page = await browser.newPage({ viewport: { width: 560, height: 460 }, colorScheme: "light" });
  await page.goto(`${server.url}?persona=${p}&live=1&seed=5`);
  await page.waitForFunction(() => window.__vikaki?.live?.state === "connected", null, { timeout: 60_000 });
  pages.push(page);
}
const ws = new WebSocket(server.wsUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true })); // Node's own WebSocket
ws.send(JSON.stringify(make("hello", { role: "driver" })));
await new Promise((r) => setTimeout(r, 500));
ws.send(JSON.stringify(make("turn_started", { seat_id: "seat-ben", persona: "ben" })));
ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-ada", utterance_id: "u1", text: "Oh, you really think so? I am not sure about that at all.", persona: "ada" }));
await pages[0]!.waitForFunction(() => window.__vikaki!.live!.events.some((e) => e.startsWith("started:")), null, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 1200));
for (const page of pages) shots.push(await page.screenshot());
ws.close();
await browser.close();
await server.close();
const { writeFileSync } = await import("node:fs");
writeFileSync(out.replace(/\.png$/, "-ada.png"), shots[0]!);
writeFileSync(out.replace(/\.png$/, "-ben.png"), shots[1]!);
console.log("wrote", out.replace(/\.png$/, "-ada.png"), out.replace(/\.png$/, "-ben.png"));
