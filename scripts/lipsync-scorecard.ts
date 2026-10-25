// The lip-sync scorecard (VIK-49): play recorded lines through the real page and score how the mouth followed each one.
//   pnpm exec tsx scripts/lipsync-scorecard.ts [--mode audio|phoneme|hybrid|all] [--json out.json] [--dir packages/audio/test/fixtures/scorecard] [--warmup 4]     (needs `pnpm build` and Chromium)
// `--mode` picks the mouth the page uses (VIK-51, `?mouth=`): audio (default, the baseline), the voice's phonemes, or both; `all` runs the three one after the other.
// The lines are recorded Kokoro speech (the fixtures' README says what each says), replayed by a stand-in engine, so a run costs nothing and
// says the same words every time. The mouth is what the page's timeline recorded while it played them. The maths is `scoreLine` in
// packages/audio, tested on its own. A report, not a gate: see docs/observability.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { alignPhonemes, decodeWav, opennessOf, scoreLine, vowelMatch, type LineScore } from "../packages/audio/src/index.ts";
import { vowelShape } from "../packages/engine/src/phoneme-visemes.ts";
import { HubClient } from "../packages/cli/src/hub-client.ts";
import { startServer } from "../packages/server/src/server.ts";
import type { AudioChunk, SynthesisRequest, Tts } from "../packages/tts/src/index.ts";
import { make } from "../packages/protocol/src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dir = flag("--dir") ?? fileURLToPath(new URL("../packages/audio/test/fixtures/scorecard/", import.meta.url));
const jsonOut = flag("--json");
const modeArg = flag("--mode") ?? "audio";
/** Extra page parameters for the phoneme mouths, to try a setting: `--articulation 1 --lead 60` (ms). */
const extra = [flag("--articulation") ? `&articulation=${flag("--articulation")}` : "", flag("--lead") ? `&lead=${flag("--lead")}` : ""].join("");
if (!["audio", "phoneme", "hybrid", "all"].includes(modeArg)) throw new Error(`--mode must be audio, phoneme, hybrid or all, not ${modeArg}`);
const modes = modeArg === "all" ? (["audio", "phoneme", "hybrid"] as const) : ([modeArg] as ("audio" | "phoneme" | "hybrid")[]);
/** Lines played and not scored first. A headless browser has no audio device, and for the first few seconds of a session its output clock is not
 * yet steady, so where the page says a line is heard is hundreds of ms out (+300, -280, -180, -100, then -40 on the first five lines, in any order). */
const warmup = Number(flag("--warmup") ?? 4);
const reverse = args.includes("--reverse"); // play them last to first, to see whether a number follows the line or its place in the run

/** Quiet either side of each line, so there is always some silence to judge the mouth's closing by. */
const LEAD_SEC = 0.3;
const TAIL_SEC = 0.5;

interface Recording {
  name: string;
  samples: Float32Array;
  rate: number;
  /** What the voice said, as IPA, for the phoneme modes (`line-N.ipa.txt`). */
  ipa: string;
}

const files = readdirSync(dir)
  .filter((f) => /^line-\d+\.wav$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
if (files.length === 0) throw new Error(`no line-N.wav in ${dir}`);
const lines: Recording[] = files.map((f) => {
  const { samples, sampleRate } = decodeWav(readFileSync(`${dir}/${f}`));
  const padded = new Float32Array(Math.round((LEAD_SEC + TAIL_SEC) * sampleRate) + samples.length);
  padded.set(samples, Math.round(LEAD_SEC * sampleRate));
  const name = f.replace(".wav", "");
  const ipaFile = `${dir}/${name}.ipa.txt`;
  return { name, samples: padded, rate: sampleRate, ipa: existsSync(ipaFile) ? readFileSync(ipaFile, "utf8").trim() : "" };
});

/** Whether the engine says what it spoke: for the phoneme modes, each line is one chunk with its phonemes (the hub times them from the audio). */
let withPhonemes = false;
/** Says each recorded line when asked for its name: in 100 ms chunks as an engine would, or whole with its phonemes. */
const replay: Tts = {
  name: "replay",
  async *synthesize(req: SynthesisRequest): AsyncGenerator<AudioChunk> {
    const line = lines.find((l) => l.name === req.text || `warm-${l.name}` === req.text);
    if (!line) throw new Error(`no recording called ${req.text}`);
    if (withPhonemes && line.ipa) return void (yield { samples: line.samples, sampleRate: line.rate, phonemes: line.ipa });
    const size = Math.round(line.rate / 10);
    for (let at = 0; at < line.samples.length; at += size) yield { samples: line.samples.subarray(at, at + size), sampleRate: line.rate };
  },
};

interface Result {
  name: string;
  fps: number;
  score: LineScore;
  /** Vowels the mouth made the right shape for, of those spoken (see `vowelMatch`). */
  vowels: { hits: number; vowels: number };
}

const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)), speech: { tts: replay, phonemes: true } });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const driver = await HubClient.connect({ url: server.wsUrl, role: "driver", client: "lipsync-scorecard" });
const all: { mode: string; results: Result[] }[] = [];

async function runMode(mode: "audio" | "phoneme" | "hybrid"): Promise<Result[]> {
  withPhonemes = mode !== "audio";
  const results: Result[] = [];
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${server.url}?live=1&timeline=1&dock=1&hud=0&seed=7&mouth=${mode}${extra}`);
  await page.waitForFunction(() => window.__vikaki?.live?.state === "connected" && window.__vikaki.live.soundBlocked === false && window.__vikaki.timelineUi, null, { timeout: 60_000 });

  const order = reverse ? [...lines].reverse() : lines;
  const plays = [...Array.from({ length: warmup }, (_, i) => ({ line: lines[i % lines.length]!, id: `warm-${i + 1}`, scored: false })), ...order.map((line) => ({ line, id: line.name, scored: true }))];
  for (const { line, id, scored } of plays) {
    const before = await page.evaluate(() => window.__vikaki!.live!.events.length);
    driver.send(make("utterance", { seat_id: "scorecard", utterance_id: id, text: line.name, emotion: "neutral" }));
    await page.waitForFunction((n) => window.__vikaki!.live!.events.slice(n).some((e) => e.startsWith("finished:")), before, { timeout: 90_000 });
    if (!scored) continue; // the clock settles by being played on; nothing is read from these
    await page.evaluate((u) => window.__vikaki!.timelineUi!.select(u), id);
    const json = JSON.parse(await page.evaluate(() => window.__vikaki!.timelineUi!.exportJson())) as {
      frames: number[][];
      utterances: { id: string; audio: { startMs: number }[] }[];
    };
    const u = json.utterances.find((x) => x.id === line.name);
    if (!u?.audio.length) throw new Error(`${line.name}: the page recorded no audio for it`);
    const start = Math.min(...u.audio.map((a) => a.startMs)); // where the line began to be heard, on the timeline's clock
    const end = start + (line.samples.length / line.rate) * 1000;
    const inLine = json.frames.filter((f) => f[0]! >= start - 50 && f[0]! <= end + 300);
    if (inLine.length < 3) throw new Error(`${line.name}: the page drew only ${inLine.length} frames while it spoke`);
    const mouth = { t: inLine.map((f) => (f[0]! - start) / 1000), open: inLine.map((f) => opennessOf(f.slice(1, 6))) }; // the commanded shapes, not the applied ones
    const spans = line.ipa ? alignPhonemes(line.ipa, line.samples, line.rate) : [];
    results.push({
      name: line.name,
      fps: (inLine.length / (inLine.at(-1)![0]! - inLine[0]![0]!)) * 1000,
      score: scoreLine(line.samples, line.rate, mouth),
      vowels: vowelMatch({ t: mouth.t, shapes: inLine.map((f) => f.slice(1, 6)) }, spans, vowelShape),
    });
  }
  await page.close();
  return results;
}

try {
  for (const mode of modes) all.push({ mode, results: await runMode(mode) });
} finally {
  driver.close().catch(() => {});
  await browser.close();
  await server.close();
}

const pct = (v: number | null) => (v === null ? "  n/a" : `${(v * 100).toFixed(0).padStart(4)}%`);
const f2 = (v: number) => v.toFixed(2).padStart(5);
const summary: { mode: string; mean: Record<string, number> }[] = [];
for (const { mode, results } of all) {
  console.log(`\nmouth: ${mode}`);
  console.log("line     secs   fps  match@0  lag(ms)  match@lag  closure  range  jitter  vowels");
  for (const { name, fps, score: s, vowels: v } of results) {
    console.log(`${name.padEnd(8)} ${s.seconds.toFixed(1).padStart(4)}  ${fps.toFixed(0).padStart(4)}  ${f2(s.loudnessMatch)}    ${String(s.lagMs).padStart(5)}    ${f2(s.matchAtBestLag)}    ${pct(s.silenceClosure)}  ${f2(s.opennessRange)}  ${s.jitter.toFixed(3)}  ${pct(v.vowels ? v.hits / v.vowels : null)}`);
  }
  const mean = (pick: (s: LineScore) => number | null) => {
    const v = results.map((r) => pick(r.score)).filter((x): x is number => x !== null);
    return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  };
  const meanFps = results.reduce((a, r) => a + r.fps, 0) / results.length;
  const hits = results.reduce((a, r) => a + r.vowels.hits, 0);
  const vowels = results.reduce((a, r) => a + r.vowels.vowels, 0);
  console.log(`mean      ${"".padStart(4)}  ${meanFps.toFixed(0).padStart(4)}  ${f2(mean((s) => s.loudnessMatch))}    ${mean((s) => s.lagMs).toFixed(0).padStart(5)}    ${f2(mean((s) => s.matchAtBestLag))}    ${pct(mean((s) => s.silenceClosure))}  ${f2(mean((s) => s.opennessRange))}  ${mean((s) => s.jitter).toFixed(3)}  ${pct(vowels ? hits / vowels : null)}`);
  summary.push({ mode, mean: { match0: mean((s) => s.loudnessMatch), lagMs: mean((s) => s.lagMs), matchAtLag: mean((s) => s.matchAtBestLag), closure: mean((s) => s.silenceClosure), range: mean((s) => s.opennessRange), jitter: mean((s) => s.jitter), vowelMatch: vowels ? hits / vowels : 0 } });
}
if (all.length > 1) {
  console.log("\n| mouth | match at 0 | lag | match at lag | closure | range | jitter | vowel shapes |\n| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const { mode, mean: m } of summary) console.log(`| ${mode} | ${m.match0!.toFixed(2)} | ${m.lagMs!.toFixed(0)} ms | ${m.matchAtLag!.toFixed(2)} | ${(m.closure! * 100).toFixed(0)}% | ${m.range!.toFixed(2)} | ${m.jitter!.toFixed(3)} | ${(m.vowelMatch! * 100).toFixed(0)}% |`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ modes: all.map((a) => ({ mode: a.mode, lines: a.results.map((r) => ({ name: r.name, fps: Math.round(r.fps * 10) / 10, ...r.score, vowels: r.vowels })) })) }, null, 2) + "\n");
