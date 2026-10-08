// Dev helper: synthesise a long sentence with the real voice (split into pieces) and report whether it still looks like speech, plus its pauses.
//   pnpm exec tsx scripts/probe-split-quality.ts <out dir>      (needs `make install-voice`)
import { mkdirSync, writeFileSync } from "node:fs";
import { analyse, classify, encodeWav } from "../packages/audio/src/index.ts";
import { spectrogramPng } from "../packages/server/src/debug/index.ts";
import { findVoice } from "../packages/cli/src/voice.ts";
import { KokoroTts } from "../packages/tts/src/index.ts";
import { splitLong } from "../packages/tts/src/split-text.mjs";

const out = process.argv[2] ?? "split-quality";
mkdirSync(out, { recursive: true });
const text = "When the committee finally met on Tuesday morning to discuss the budget, nobody had read the report that everybody had been sent, so the meeting ran long, and several people left before it ended, which surprised no one at all.";
console.log("pieces:", JSON.stringify(splitLong(text, 70)));
const tts = await KokoroTts.create({ importFrom: findVoice()!.entry });
const parts: Float32Array[] = [];
let rate = 24000;
for await (const c of tts.synthesize({ text })) (parts.push(c.samples), (rate = c.sampleRate));
const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
let at = 0;
for (const p of parts) (samples.set(p, at), (at += p.length));
const m = analyse(samples, rate);
console.log(`${(samples.length / rate).toFixed(1)} s in ${parts.length} chunks; verdict: ${classify(m)}; longest pause ${m.longestPauseSec.toFixed(2)} s; pauses: ${m.pauses.map((p) => `${p.startSec.toFixed(2)}+${(p.endSec - p.startSec).toFixed(2)}`).join(" ")}`);
console.log("chunk boundaries (s):", parts.reduce<number[]>((acc, p) => (acc.push((acc.at(-1) ?? 0) + p.length / rate), acc), []).map((x) => x.toFixed(2)).join(" "));
writeFileSync(`${out}/split.wav`, encodeWav(samples, rate));
writeFileSync(`${out}/split.png`, spectrogramPng(samples, rate));
await tts.close();
process.exit(0);
