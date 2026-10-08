// Manual check, needs internet and is NOT part of CI (a third-party site would make CI flaky).
// Loads the built extension and runs it on the official WebRTC sample pages: the device picker, and a
// real RTCPeerConnection call whose remote end should show the avatar.
// usage: node packages/extension/build.mjs --out /tmp/vikaki-ext --extra-match "https://webrtc.github.io/*"
//        node scripts/real-site-check.mjs /tmp/vikaki-ext [screenshot.png]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [ext, shot] = process.argv.slice(2);
if (!ext) {
  console.error("usage: node scripts/real-site-check.mjs <built-extension-dir> [screenshot.png]");
  process.exit(1);
}
const fixture = fileURLToPath(new URL("../packages/e2e/fixtures/vowel-aa.wav", import.meta.url));
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "vikaki-real-")), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${fixture}`, "--autoplay-policy=no-user-gesture-required"],
});
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};
try {
  const d = await ctx.newPage();
  await d.goto("https://webrtc.github.io/samples/src/content/devices/input-output/", { timeout: 45000 });
  await d.waitForTimeout(1500);
  const cams = await d.evaluate(() => [...document.querySelectorAll("#videoSource option")].map((o) => o.text));
  check("the page offers only the avatar as a camera", cams.length === 1 && cams[0] === "Vikaki Avatar", cams.join(", "));
  await d.close();

  const p = await ctx.newPage();
  await p.goto("https://webrtc.github.io/samples/src/content/peerconnection/pc1/", { timeout: 45000 });
  await p.click("#startButton");
  await p.waitForFunction(() => document.getElementById("localVideo").videoWidth > 0, null, { timeout: 30000 });
  await p.click("#callButton");
  await p.waitForFunction(() => document.getElementById("remoteVideo").videoWidth > 0, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => {
    const brown = (id) => {
      const v = document.getElementById(id), c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext("2d"); g.drawImage(v, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 140 && px[i] < 215 && px[i + 1] > 85 && px[i + 1] < 150 && px[i + 2] > 30 && px[i + 2] < 100) n++;
      return n / (px.length / 4);
    };
    return { local: brown("localVideo"), remote: brown("remoteVideo"), ext: { ...window.__vikakiExt } };
  });
  check("the remote peer receives avatar frames over WebRTC", r.remote > 0.08, `avatar share ${r.remote.toFixed(2)}`);
  check("the physical camera was never requested", r.ext.physicalCameraRequests === 0);
  check("lip sync is running", r.ext.mouthKind === "wlipsync" || r.ext.mouthKind === "amplitude", r.ext.mouthKind);
  if (shot) await p.screenshot({ path: shot });
} finally {
  await ctx.close();
}
process.exit(failed ? 1 : 0);
