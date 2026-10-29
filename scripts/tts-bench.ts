// The TTS bench (VIK-140): say the same twelve poker lines (a taunt, a worried thought, a win, a bust-out, with their emotions) through each engine that
// is set up, write the audio to listen to, and print a table of how fast each one is. Engines whose key or server is missing are skipped with the fix.
//
//   pnpm exec tsx scripts/tts-bench.ts [--engines kokoro,openai,chatterbox,qwen,fake] [--out DIR] [--lines FILE] [--log events.jsonl] [--blind [--seed N]]
//
// --blind names the clips A01, A02... in a shuffled order and writes the answer to key.json, so a listener scores them with docs/voice-rubric.md without knowing
// the engine. results.json (numbers only) is always written, to keep a baseline.
//
//   kokoro      the baseline, if installed (`make install-voice`)
//   openai      gpt-4o-mini-tts: needs OPENAI_API_KEY in the environment (this costs a few cents a run)
//   chatterbox  a Chatterbox server with an OpenAI-style speech route: CHATTERBOX_URL=http://host:port/v1 (and CHATTERBOX_API_KEY if it wants one)
//   qwen        a Qwen3-TTS server likewise: QWEN_TTS_URL, QWEN_TTS_API_KEY
//   fake        a test tone, to try the harness with no engine
//
// With --log (a `vikaki serve --event-log` file from a real game) it also prints what that game's speech would cost with each provider.
// Keys are read from the environment only and are never printed.
// Keys may live in a .env at the repo root (see .env.example); a variable already in the environment wins.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}
import { findVoice } from "../packages/cli/src/voice.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { blindKey, ChatterboxTts, costOf, FakeTts, KokoroTts, PRICES, PROVIDERS, report, resultsJson, runBench, speechStats, SpeechApiTts, toWav, type BenchLine, type Tts } from "../packages/tts/src/index.ts";

const { values } = parseArgs({
  options: {
    engines: { type: "string", default: "kokoro" },
    out: { type: "string", default: "tts-bench-out" },
    lines: { type: "string", default: new URL("./tts-bench-lines.json", import.meta.url).pathname },
    log: { type: "string" },
    blind: { type: "boolean", default: false },
    seed: { type: "string", default: "1" },
  },
});

/** CHATTERBOX_PACE="-0.15,0.3" is the exaggeration delta and the cfg_weight cap (VIK-150); unset is the adapter's default pace; "none" is Chatterbox's own numbers. */
function chatterboxPaceFromEnv() {
  const v = process.env.CHATTERBOX_PACE;
  if (!v) return undefined;
  if (v === "none") return null;
  const [d, c] = v.split(",").map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(c)) throw new Error('CHATTERBOX_PACE is "exaggerationDelta,cfgWeightCap", such as "-0.15,0.3"');
  return { exaggerationDelta: d!, cfgWeightCap: c! };
}

async function engine(name: string): Promise<{ tts: Tts; skip?: undefined } | { tts?: undefined; skip: string }> {
  if (name === "fake") return { tts: new FakeTts({ sampleRate: 24000, msPerChar: 60, chunkMs: 120 }) };
  if (name === "kokoro") {
    try {
      return { tts: await KokoroTts.create({ importFrom: findVoice()?.entry }) };
    } catch (err) {
      return { skip: `Kokoro is not installed (${(err as Error).message.slice(0, 60)}). Run \`make install-voice\`.` };
    }
  }
  if (name === "openai") return process.env.OPENAI_API_KEY ? { tts: new SpeechApiTts(PROVIDERS.openai()) } : { skip: "set OPENAI_API_KEY in the environment (a few cents a run)" };
  if (name === "chatterbox") return process.env.CHATTERBOX_URL ? { tts: new ChatterboxTts({ pace: chatterboxPaceFromEnv() }) } : { skip: "set CHATTERBOX_URL to your server's /v1 (see docs/tts-providers.md)" };
  if (name === "qwen") return process.env.QWEN_TTS_URL ? { tts: new SpeechApiTts(PROVIDERS.qwen()) } : { skip: "set QWEN_TTS_URL to your server's /v1 (see docs/tts-providers.md)" };
  return { skip: `unknown engine "${name}" (kokoro, openai, chatterbox, qwen, fake)` };
}

const lines = JSON.parse(await readFile(values.lines!, "utf8")) as BenchLine[];
await mkdir(values.out!, { recursive: true });
const sections: string[] = [];
const all: { engine: string; results: Awaited<ReturnType<typeof runBench>> }[] = [];
for (const name of values.engines!.split(",").map((s) => s.trim()).filter(Boolean)) {
  const e = await engine(name);
  if (e.skip) {
    console.log(`skipped ${name}: ${e.skip}`);
    continue;
  }
  console.log(`running ${name} on ${lines.length} lines (after one untimed warm-up line: the first call loads a model or opens a connection)...`);
  await runBench(e.tts, [{ label: "warm-up", text: "Ready to play, everyone." }]);
  const results = await runBench(e.tts, lines);
  all.push({ engine: name, results });
  sections.push(report(name, results));
  await e.tts.close?.();
}
const wavName = (engine: string, label: string, i: number, code?: string) => (code ?? `${engine}-${String(i + 1).padStart(2, "0")}-${label.replace(/\W+/g, "-")}`) + ".wav";
const key = values.blind ? blindKey(all.flatMap((a) => a.results.filter((r) => r.samples.length).map((r) => ({ engine: a.engine, label: r.label }))), Number(values.seed)) : [];
await Promise.all(
  all.flatMap(({ engine, results }) =>
    results.filter((r) => r.samples.length).map((r, i) => writeFile(`${values.out}/${wavName(engine, r.label, i, key.find((k) => k.engine === engine && k.label === r.label)?.code)}`, toWav(r.samples, r.sampleRate))),
  ),
);
if (all.length) await writeFile(`${values.out}/results.json`, JSON.stringify(all.flatMap((a) => resultsJson(a.engine, a.results)), null, 2) + "\n");
if (key.length) {
  await writeFile(`${values.out}/key.json`, JSON.stringify(key, null, 2) + "\n");
  console.log(`Blind: clips are named A01...; the answer is in ${values.out}/key.json. Do not open it until you have scored them.`);
}
if (values.log) {
  const events = (await readFile(values.log, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { at?: number; message: Record<string, unknown> });
  const s = speechStats(events);
  sections.push(
    [
      `### Cost of the speech in ${values.log}`,
      "",
      `${s.lines} lines, ${s.characters} characters, about ${s.minutes.toFixed(1)} minutes of audio over a ${(s.wallMinutes ?? 0).toFixed(0)}-minute game.`,
      "",
      "| Provider | Estimated cost | Assumption |",
      "| --- | --- | --- |",
      ...PRICES.map((p) => `| ${p.name} | $${costOf(s, p).toFixed(3)} | ${p.note} |`),
    ].join("\n"),
  );
}
if (sections.length) {
  const md = sections.join("\n\n") + "\n";
  await writeFile(`${values.out}/results.md`, md);
  console.log("\n" + md + `\nAudio and results.md are in ${values.out}/. Listen to the .wav files side by side: speed is only half of it.`);
}
