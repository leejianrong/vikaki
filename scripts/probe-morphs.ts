// Dev helper: show what each morph target of the avatar does, one screenshot per target at full weight.
//   pnpm exec tsx scripts/probe-morphs.ts <outdir> [avatar.vrm url]     (needs `pnpm build`)
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "../packages/server/src/server.ts";

const [out = "morphs"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)) });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
await page.goto(`${server.url}?hud=0&seed=3`);
await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
const info = await page.evaluate(() => {
  const meshes: { name: string; count: number }[] = [];
  (window.__vikaki!.avatar as { scene: { traverse(f: (o: { name: string; morphTargetInfluences?: number[] }) => void): void } }).scene.traverse((o) => {
    if (o.morphTargetInfluences) meshes.push({ name: o.name, count: o.morphTargetInfluences.length });
  });
  return meshes;
});
console.log("meshes with morph targets:", JSON.stringify(info));
const count = Math.max(...info.map((m) => m.count));
for (let i = -1; i < count; i++) {
  await page.evaluate((k) => {
    (window.__vikaki!.avatar as { scene: { traverse(f: (o: { morphTargetInfluences?: number[] }) => void): void } }).scene.traverse((o) => {
      if (o.morphTargetInfluences) o.morphTargetInfluences.fill(0), k >= 0 && (o.morphTargetInfluences[k] = 1);
    });
  }, i);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/m${String(i + 1).padStart(2, "0")}.png` });
}
await browser.close();
await server.close();
