import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWav } from "@vikaki/server";

export const RATE = 48000;

/** A voice-like tone with a pitch contour and loudness, as `ProsodyTracker`'s own tests make. */
export function voice(seconds: number, f0: (t: number) => number, amp: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * f0(t)) / RATE;
    out[i] = (amp(t) * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase))) / 1.75;
  }
  return out;
}

/** 0.6 s quiet, a 2 s phrase (a stressed word at 0.9 s, a rising end after 1.4 s), 2 s quiet. Chromium's fake mic loops it. */
export async function makeFixture(): Promise<string> {
  const phrase = voice(2, (t) => (t < 1.4 ? 120 : 120 + (t - 1.4) * 110), (t) => (t > 0.9 && t < 1.1 ? 0.7 : 0.25));
  const clip = new Float32Array(RATE * 4.6);
  clip.set(phrase, Math.round(0.6 * RATE));
  const dir = await mkdtemp(join(tmpdir(), "vikaki-prosody-"));
  const file = join(dir, "phrase.wav");
  await writeFile(file, encodeWav(clip, RATE));
  return file;
}
