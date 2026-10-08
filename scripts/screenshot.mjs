// Dev helper: screenshot the avatar page in headless Chromium (software WebGL, no GPU needed).
// usage: node scripts/screenshot.mjs <url> <out.png> [visemeJson]   e.g. '{"aa":1}'
import { chromium } from "playwright";

const [url, out, visemes] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/screenshot.mjs <url> <out.png> [visemeJson]");
  process.exit(1);
}

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on("console", (m) => m.type() === "error" && console.error("page error:", m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30000 });
  if (visemes) await page.evaluate((v) => window.__vikaki.setVisemes(JSON.parse(v)), visemes);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out });
  console.log("wrote", out);
} finally {
  await browser.close();
}
