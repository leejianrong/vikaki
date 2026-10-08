// Dev helper: does what the avatar displays follow what we set? Holds each mouth shape at several weights and
// prints commanded vs applied. usage: pnpm exec tsx scripts/probe-applied.ts   (needs `pnpm build`)
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "../packages/server/src/server.ts";

const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)) });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 640, height: 480 } });
await p.goto(`${server.url}?demo=1&seed=7`);
await p.waitForFunction(() => window.__vikaki?.ready, null, { timeout: 60000 });
for (const shape of ["aa", "ih", "ou", "ee", "oh"] as const) {
  const rows: string[] = [];
  for (const w of [0, 0.25, 0.5, 1]) {
    const r = await p.evaluate(async ([shape, w]) => {
      window.__vikaki!.setVisemes({ [shape as string]: w as number });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { set: window.__vikaki!.visemes[shape as "aa"] ?? 0, shown: window.__vikaki!.applied[shape as "aa"] ?? -1 };
    }, [shape, w] as const);
    rows.push(`${r.set} -> ${r.shown.toFixed(3)}`);
  }
  console.log(shape.padEnd(3), rows.join("   "));
}
await b.close();
await server.close();
