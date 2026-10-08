// Dev helper: run the prosody tracker over a WAV file and print the cues it finds, to judge it on real speech.
//   pnpm exec tsx scripts/probe-prosody.ts <file.wav>
import { readFileSync } from "node:fs";
import { decodeWav, ProsodyTracker } from "../packages/audio/src/index.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: probe-prosody.ts <file.wav>");
const { samples, sampleRate } = decodeWav(new Uint8Array(readFileSync(file)));
const tracker = new ProsodyTracker();
const win = 2048;
const hop = Math.round(sampleRate / 30);
const out: string[] = [];
for (let end = win; end <= samples.length; end += hop) for (const e of tracker.push(samples.subarray(end - win, end), sampleRate, end / sampleRate)) out.push(`${e.cue}@${e.t.toFixed(2)}s`);
console.log(`${file.split("/").pop()}: ${(samples.length / sampleRate).toFixed(1)} s, ${out.length} cues: ${out.join("  ") || "(none)"}`);
