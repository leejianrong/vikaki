import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeWav, estimateWordTimings, syllables } from "../src/index.ts";

const RATE = 16000;
/** A 220 Hz tone in each [start, end] second range, silence elsewhere, `total` seconds long. */
function bursts(spans: [number, number][], total: number): Float32Array {
  const x = new Float32Array(Math.round(total * RATE));
  for (const [a, b] of spans) {
    for (let i = Math.round(a * RATE); i < Math.min(x.length, Math.round(b * RATE)); i++) {
      const t = i / RATE;
      const fade = Math.min(1, (t - a) / 0.01, (b - t) / 0.01);
      x[i] = 0.5 * fade * Math.sin(2 * Math.PI * 220 * t);
    }
  }
  return x;
}

describe("syllables", () => {
  it("counts roughly right, and never less than one", () => {
    expect(["the", "one", "make", "banana", "people", "I", "42", "hello", "everyone", "你好", "..."].map(syllables)).toEqual([1, 1, 1, 3, 2, 1, 1, 2, 3, 2, 1]);
  });
});

describe("estimateWordTimings", () => {
  it("puts the boundaries in the gaps between words when the words are evenly spoken", () => {
    const spans: [number, number][] = [[0.2, 0.5], [0.65, 0.95], [1.1, 1.4], [1.55, 1.9]];
    const w = estimateWordTimings("ba da ga ma", bursts(spans, 2.2), RATE);
    expect(w.map((x) => x.word)).toEqual(["ba", "da", "ga", "ma"]);
    expect(w[0]!.start).toBeCloseTo(0.2, 1);
    expect(w[3]!.end).toBeCloseTo(1.9, 1);
    for (let i = 0; i < 3; i++) {
      expect(w[i]!.end, `word ${i} ends after its sound`).toBeGreaterThanOrEqual(spans[i]![1] - 0.02);
      expect(w[i + 1]!.start, `word ${i + 1} starts before its sound`).toBeLessThanOrEqual(spans[i + 1]![0] + 0.02);
    }
  });

  it("gives long words more time than short ones, and still lands the boundaries in the gaps", () => {
    const spans: [number, number][] = [[0.2, 0.4], [0.5, 1.1], [1.2, 1.4], [1.5, 2.1]]; // 1, 3, 1, 3 syllables
    const w = estimateWordTimings("a banana a banana", bursts(spans, 2.3), RATE);
    for (let i = 0; i < 3; i++) {
      expect(w[i]!.end).toBeGreaterThanOrEqual(spans[i]![1] - 0.02);
      expect(w[i + 1]!.start).toBeLessThanOrEqual(spans[i + 1]![0] + 0.02);
    }
  });

  it("leaves a real pause between words out of both of them", () => {
    const w = estimateWordTimings("hello, world", bursts([[0.1, 0.6], [1.3, 1.8]], 2), RATE);
    expect(w[0]!.end).toBeLessThanOrEqual(0.65);
    expect(w[1]!.start).toBeGreaterThanOrEqual(1.25);
  });

  it("does not count leading or trailing silence as speech", () => {
    const w = estimateWordTimings("one two", bursts([[1, 1.4], [1.5, 1.9]], 3), RATE);
    expect(w[0]!.start).toBeGreaterThan(0.95);
    expect(w[1]!.end).toBeLessThan(1.95);
  });

  it("spreads words over the whole clip when there is no sound to go by", () => {
    const w = estimateWordTimings("one two three", new Float32Array(3 * RATE), RATE);
    expect(w).toHaveLength(3);
    expect(w[0]!.start).toBeCloseTo(0, 1);
    expect(w[2]!.end).toBeCloseTo(3, 1);
    expect(w[1]!.start).toBeGreaterThan(w[0]!.start);
  });

  it("has nothing to say about empty text", () => {
    expect(estimateWordTimings("   ", bursts([[0, 1]], 1), RATE)).toEqual([]);
  });

  it("on real speech, puts each boundary where it is quieter than the middle of the words either side", () => {
    const { samples, sampleRate } = decodeWav(readFileSync(new URL("./fixtures/kokoro-good-morning.wav", import.meta.url)));
    const w = estimateWordTimings("Good morning, everyone.", samples, sampleRate);
    expect(w.map((x) => x.word)).toEqual(["Good", "morning,", "everyone."]);
    const rms = (from: number, to: number) => {
      let sq = 0;
      const a = Math.max(0, Math.round(from * sampleRate));
      const b = Math.min(samples.length, Math.round(to * sampleRate));
      for (let i = a; i < b; i++) sq += samples[i]! * samples[i]!;
      return Math.sqrt(sq / Math.max(1, b - a));
    };
    for (let i = 0; i < 2; i++) {
      const boundary = (w[i]!.end + w[i + 1]!.start) / 2;
      const middles = [(w[i]!.start + w[i]!.end) / 2, (w[i + 1]!.start + w[i + 1]!.end) / 2];
      expect(rms(boundary - 0.015, boundary + 0.015)).toBeLessThan(Math.min(...middles.map((m) => rms(m - 0.03, m + 0.03))));
    }
    expect(w[0]!.start).toBeGreaterThanOrEqual(0);
    expect(w[2]!.end).toBeLessThanOrEqual(samples.length / sampleRate + 0.001);
  });
});

describe("estimateWordTimings properties", () => {
  const word = fc.constantFrom("a", "Hello,", "world.", "banana", "你好", "I'm", "42", "wow!", "—", "extraordinarily");
  const text = fc.array(word, { minLength: 1, maxLength: 12 }).map((w) => w.join(" "));
  const audio = fc.float32Array({ minLength: 0, maxLength: 24_000, noNaN: true, min: -1, max: 1, noDefaultInfinity: true });

  it("always returns every word once, in order, without overlap, whatever the audio", () => {
    fc.assert(
      fc.property(text, audio, (t, x) => {
        const w = estimateWordTimings(t, x, RATE);
        const n = t.split(" ").length;
        const limit = Math.max(x.length / RATE, n * 0.03) + 1e-6;
        return (
          w.length === n &&
          w.every((s, i) => s.word === t.split(" ")[i] && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end >= s.start + 0.03 - 1e-9 && s.end <= limit && (i === 0 || s.start >= w[i - 1]!.end - 1e-9))
        );
      }),
      { numRuns: 150 },
    );
  });
});
