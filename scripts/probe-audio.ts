// Print the speech-or-buzz numbers for WAV files, and write a spectrogram PNG next to each.
//   pnpm exec tsx scripts/probe-audio.ts a.wav b.wav
import { readFileSync, writeFileSync } from "node:fs";
import { analyse, classify } from "../packages/audio/src/metrics.ts";
import { spectrogramPng } from "../packages/server/src/debug/spectrogram.ts";
import { decodeWav } from "../packages/audio/src/index.ts";

for (const file of process.argv.slice(2)) {
  const { samples, sampleRate } = decodeWav(readFileSync(file));
  const m = analyse(samples, sampleRate);
  writeFileSync(file.replace(/\.wav$/, "") + ".png", spectrogramPng(samples, sampleRate));
  console.log(file.split("/").pop(), JSON.stringify({ ...m, pauses: m.pauses.length }), classify(m).verdict);
}
