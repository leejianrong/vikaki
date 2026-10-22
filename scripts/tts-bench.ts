// The TTS bench (VIK-140): say the same twelve poker lines (a taunt, a worried thought, a win, a bust-out, with their emotions) through each engine that
// is set up, write the audio to listen to, and print a table of how fast each one is. Engines whose key or server is missing are skipped with the fix.
//
//   pnpm exec tsx scripts/tts-bench.ts [--engines kokoro,openai,chatterbox,qwen,fake] [--out DIR] [--lines FILE] [--log events.jsonl]
//
//   kokoro      the baseline, if installed (`make install-voice`)
//   openai      gpt-4o-mini-tts: needs OPENAI_API_KEY in the environment (this costs a few cents a run)
//   chatterbox  a Chatterbox server with an OpenAI-style speech route: CHATTERBOX_URL=http://host:port/v1 (and CHATTERBOX_API_KEY if it wants one)
//   qwen        a Qwen3-TTS server likewise: QWEN_TTS_URL, QWEN_TTS_API_KEY
//   fake        a test tone, to try the harness with no engine
//
// With --log (a `vikaki serve --event-log` file from a real game) it also prints what that game's speech would cost with each provider.
// Keys are read from the environment only and are never printed.
import { findVoice } from "../packages/cli/src/voice.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { costOf, FakeTts, KokoroTts, PRICES, PROVIDERS, report, runBench, speechStats, SpeechApiTts, toWav, type BenchLine, type Tts } from "../packages/tts/src/index.ts";

const { values } = parseArgs({
  options: {
    engines: { type: "string", default: "kokoro" },
    out: { type: "string", default: "tts-bench-out" },
    lines: { type: "string", default: new URL("./tts-bench-lines.json", import.meta.url).pathname },
    log: { type: "string" },
  },
});

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
  if (name === "chatterbox") return process.env.CHATTERBOX_URL ? { tts: new SpeechApiTts(PROVIDERS.chatterbox()) } : { skip: "set CHATTERBOX_URL to your server's /v1 (see docs/tts-providers.md)" };
  if (name === "qwen") return process.env.QWEN_TTS_URL ? { tts: new SpeechApiTts(PROVIDERS.qwen()) } : { skip: "set QWEN_TTS_URL to your server's /v1 (see docs/tts-providers.md)" };
  return { skip: `unknown engine "${name}" (kokoro, openai, chatterbox, qwen, fake)` };
}

const lines = JSON.parse(await readFile(values.lines!, "utf8")) as BenchLine[];
await mkdir(values.out!, { recursive: true });
const sections: string[] = [];
for (const name of values.engines!.split(",").map((s) => s.trim()).filter(Boolean)) {
  const e = await engine(name);
  if (e.skip) {
    console.log(`skipped ${name}: ${e.skip}`);
    continue;
  }
  console.log(`running ${name} on ${lines.length} lines...`);
  const results = await runBench(e.tts, lines);
  await Promise.all(results.filter((r) => r.samples.length).map((r, i) => writeFile(`${values.out}/${name}-${String(i + 1).padStart(2, "0")}-${r.label.replace(/\W+/g, "-")}.wav`, toWav(r.samples, r.sampleRate))));
  sections.push(report(name, results));
  await e.tts.close?.();
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
