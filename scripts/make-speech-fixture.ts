// Make a short real-speech clip with Kokoro (Apache-2.0) as a golden test fixture, or any clip for inspection.
//   pnpm exec tsx scripts/make-speech-fixture.ts "Good morning, everyone." out.wav [voice]
// Needs the real voice: `make install-voice`.
import { writeFileSync } from "node:fs";
import { KokoroTts } from "../packages/tts/src/index.ts";
import { encodeWav } from "../packages/server/src/debug/wav.ts";
import { findVoice } from "../packages/cli/src/voice.ts";

const [text, out, voice] = process.argv.slice(2);
if (!text || !out) {
  console.error('usage: tsx scripts/make-speech-fixture.ts "<text>" <out.wav> [voice]');
  process.exit(1);
}
const found = findVoice();
if (!found) {
  console.error("the real voice is not installed; run `make install-voice`");
  process.exit(1);
}
const tts = await KokoroTts.create({ voice, importFrom: found.entry });
const parts: Float32Array[] = [];
let rate = 24000;
for await (const c of tts.synthesize({ text, voice })) {
  parts.push(c.samples);
  rate = c.sampleRate;
}
const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
let at = 0;
for (const p of parts) {
  all.set(p, at);
  at += p.length;
}
writeFileSync(out, encodeWav(all, rate));
console.log(`wrote ${out}: ${(all.length / rate).toFixed(2)} s at ${rate} Hz`);
