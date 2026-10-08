import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyse, classify, decodeWav, encodeWav } from "../src/index.ts";

const rate = fc.constantFrom(8000, 16000, 24000, 44100);
const audio = fc.float32Array({ maxLength: 6000, noNaN: true, min: -1, max: 1, noDefaultInfinity: true });
const golden = decodeWav(readFileSync(new URL("./fixtures/kokoro-good-morning.wav", import.meta.url)));

describe("audio analysis properties", () => {
  it("never produces NaN or out-of-range numbers, whatever the audio", () => {
    fc.assert(
      fc.property(audio, rate, (x, r) => {
        const m = analyse(x, r);
        const numbers = [m.durationSec, m.peak, m.clippedRatio, m.activeRatio, m.loudnessVariation, m.spectralWanderHz, m.longestPauseSec];
        return (
          numbers.every((n) => Number.isFinite(n) && n >= 0) &&
          m.activeRatio <= 1 &&
          m.clippedRatio <= 1 &&
          m.pauses.every((p, i) => p.endSec > p.startSec && p.endSec <= m.durationSec + 0.05 && (i === 0 || p.startSec >= m.pauses[i - 1]!.endSec)) &&
          ["speech", "buzz", "silence"].includes(classify(m).verdict)
        );
      }),
      { numRuns: 60 },
    );
  });

  it("does not care how loud the recording is: the verdict and loudness variation are scale-free", () => {
    const base = analyse(golden.samples, golden.sampleRate);
    fc.assert(
      fc.property(fc.double({ min: 0.3, max: 1, noNaN: true }), (g) => {
        const m = analyse(golden.samples.map((v) => v * g), golden.sampleRate);
        return classify(m).verdict === "speech" && Math.abs(m.loudnessVariation - base.loudnessVariation) < 0.01 * base.loudnessVariation;
      }),
      { numRuns: 15 },
    );
  });

  it("round-trips a WAV: same rate, same length, within one 16-bit step", () => {
    fc.assert(
      fc.property(audio, rate, (x, r) => {
        const back = decodeWav(encodeWav(x, r));
        return back.sampleRate === r && back.samples.length === x.length && x.every((v, i) => Math.abs(v - back.samples[i]!) <= 1 / 32768 + 1e-7);
      }),
      // the case CI's random run found: positives were scaled by 32767 on the way out and 32768 on the way back
      { numRuns: 40, examples: [[Float32Array.of(0.6205750703811646), 8000]] },
    );
  });

  it("a constant level of any size is a buzz or silence, never speech", () => {
    fc.assert(
      fc.property(fc.double({ min: -1, max: 1, noNaN: true }), fc.integer({ min: 3000, max: 20000 }), (level, n) => {
        const v = classify(analyse(new Float32Array(n).fill(level), 16000)).verdict;
        expect(v).not.toBe("speech");
      }),
      { numRuns: 30 },
    );
  });
});
