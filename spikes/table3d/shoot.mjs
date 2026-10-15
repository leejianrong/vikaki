// usage (with the spike's vite server on :5199): node spikes/table3d/shoot.mjs <outDir> [cam,cam,...] [arms=off]
import { chromium } from "playwright";
const [out, cams = "bust,high,low,top", arms] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const cam of cams.split(",")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (m) => m.type() === "error" && console.error("page error:", m.text()));
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`http://127.0.0.1:5199/?cam=${cam}${arms ? "&arms=off" : ""}`);
    await page.waitForFunction(() => window.__spike?.ready, null, { timeout: 60000 });
    console.log(cam, JSON.stringify(await page.evaluate(() => window.__spike)));
    await page.screenshot({ path: `${out}/${cam}${arms ? "-armsdown" : ""}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
