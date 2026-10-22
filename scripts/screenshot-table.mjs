// Dev helper: drive the poker table page with `table_state` messages and screenshot it (the machine is software-rendered, so drive states directly).
// Start a table first: `pnpm serve --port 8787 --personas personas.table.example.yaml` (after `pnpm build`).
// usage: node scripts/screenshot-table.mjs <steps.json> <outPrefix> [query]   (PORT, VIEWPORT=WxH)
// steps.json: [{ "state": {...table_state fields}, "msg": {type, ...fields}, "wait": 800, "shot": "name" }, ...]; `shot` writes <outPrefix>-<name>.png.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const [stepsFile, prefix, query = "seats=3&view=table"] = process.argv.slice(2);
if (!stepsFile || !prefix) {
  console.error("usage: node scripts/screenshot-table.mjs <steps.json> <outPrefix> [query]");
  process.exit(1);
}
const port = process.env.PORT ?? "8787";
const WebSocket = createRequire(new URL("../packages/e2e/package.json", import.meta.url))("ws");
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
const [vw, vh] = (process.env.VIEWPORT ?? "1280x720").split("x").map(Number);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
try {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on("console", (m) => m.type() === "error" && console.error("page error:", m.text()));
  await page.goto(`http://127.0.0.1:${port}/avatar?${query}`);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 60000 });
  if (ws.readyState !== WebSocket.OPEN) await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
  const seats = [["seat-1", "ada"], ["seat-2", "ben"], ["seat-3", "cy"]].map(([seat_id, persona]) => ({ seat_id, persona }));
  ws.send(JSON.stringify({ protocol_version: 1, type: "hello", role: "driver", seats }));
  await new Promise((r) => setTimeout(r, 500));
  for (const step of steps) {
    if (step.state) ws.send(JSON.stringify({ protocol_version: 1, type: "table_state", ...step.state }));
    if (step.msg) ws.send(JSON.stringify({ protocol_version: 1, ...step.msg }));
    await new Promise((r) => setTimeout(r, step.wait ?? 600));
    if (step.shot) await page.screenshot({ path: `${prefix}-${step.shot}.png` });
  }
} finally {
  ws.terminate();
  await browser.close();
}
