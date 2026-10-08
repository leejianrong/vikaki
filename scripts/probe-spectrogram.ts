// Dev helper: how long does the timeline take to compute the spectrogram of one utterance of a given length, in one go?
//   pnpm exec tsx scripts/probe-spectrogram.ts
import { spectrogramPixels } from "../packages/engine/src/timeline-draw.ts";

for (const seconds of [5, 30, 120, 600]) {
  const rate = 24000;
  const samples = new Float32Array(rate * seconds).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate) * (0.6 + 0.4 * Math.sin(i / 3000)));
  const started = performance.now();
  spectrogramPixels([{ samples, rate, startMs: 0 }], { fromMs: 0, toMs: seconds * 1000 }, 1200, 160);
  console.log(`${String(seconds).padStart(4)} s of speech: ${(performance.now() - started).toFixed(0).padStart(5)} ms for the first draw`);
}
