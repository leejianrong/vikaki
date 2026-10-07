import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";

const only = process.argv.slice(2);
const clips = readdirSync("clips").filter(f => !only.length || only.some(o => f.includes(o)));

// onset = first 10 ms frame whose RMS exceeds 5% of the clip's peak RMS
function onset(file) {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", `clips/${file}`, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  const f = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const n = 160, rms = [];
  for (let i = 0; i + n <= f.length; i += n) { let s = 0; for (let j = 0; j < n; j++) s += f[i + j] ** 2; rms.push(Math.sqrt(s / n)); }
  const peak = Math.max(...rms);
  if (peak < 1e-4) return null;
  const k = rms.findIndex(r => r > 0.05 * peak);
  return k * 0.01;
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"] });
const page = await browser.newPage();
page.on("pageerror", e => console.error("pageerror", e.message));
await page.goto("http://127.0.0.1:8801/");
await page.waitForFunction(() => window.spikeReady);

const MAP_WAWA = { aa: "aa", E: "ee", I: "ih", O: "oh", U: "ou" };
const MAP_WL = { A: "aa", E: "ee", I: "ih", O: "oh", U: "ou" };
const results = [];
for (const clip of clips) {
  const url = `/clips/${clip}`;
  const on = onset(clip);
  const row = { clip, onset: on };
  for (const lib of ["wawa", "wl"]) {
    const samples = await page.evaluate(([l, u]) => (l === "wawa" ? window.runWawa(u) : window.runWl(u)), [lib, url]);
    const seq = [];
    for (const s of samples) {
      let v = "none", open = 0;
      if (lib === "wawa") { v = MAP_WAWA[s.v] ?? (s.v === "sil" ? "sil" : "cons"); open = s.v === "sil" ? 0 : 1; }
      else {
        const ent = Object.entries(s.w).filter(([k]) => MAP_WL[k]);
        const [k, w] = ent.sort((a, b) => b[1] - a[1])[0] ?? [];
        open = s.vol; v = s.vol > 0.05 && k ? MAP_WL[k] : "sil";
      }
      seq.push({ t: s.t, v, open });
    }
    const active = seq.filter(s => s.v !== "sil");
    const share = {};
    for (const s of active) share[s.v] = (share[s.v] ?? 0) + 1;
    for (const k in share) share[k] = +(share[k] / active.length).toFixed(2);
    const switches = seq.slice(1).filter((s, i) => s.v !== seq[i].v).length;
    const dur = seq.at(-1)?.t ?? 1;
    const firstActive = active[0]?.t ?? null;
    row[lib] = { frames: seq.length, activeFrac: +(active.length / seq.length).toFixed(2), share, switchesPerSec: +(switches / dur).toFixed(1), firstActive: firstActive == null ? null : +firstActive.toFixed(2), maxOpen: +Math.max(...seq.map(s => s.open)).toFixed(2) };
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync("results.json", JSON.stringify(results, null, 1));
await browser.close();
