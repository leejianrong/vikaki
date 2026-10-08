import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { synthVowel } from "@vikaki/tts";
import { analyse, classify, decodeWav, encodeWav, spectrogramPng } from "../src/server.ts";

const golden = () => decodeWav(readFileSync(new URL("./fixtures/kokoro-good-morning.wav", import.meta.url)));

/** Tone with its loudness wobbling like speech but a fixed timbre. */
function wobblingTone(seconds: number, rate: number): Float32Array {
  const x = synthVowel(seconds, rate);
  return x.map((v, i) => v * (0.55 + 0.45 * Math.sin((2 * Math.PI * 3 * i) / rate)));
}

describe("speech or buzz (the gate)", () => {
  it("real Kokoro speech is speech, with the measured spread", () => {
    const { samples, sampleRate } = golden();
    const m = analyse(samples, sampleRate);
    expect(classify(m)).toEqual({ verdict: "speech", reasons: [] });
    expect(m.loudnessVariation).toBeGreaterThan(0.4);
    expect(m.spectralWanderHz).toBeGreaterThan(1000);
  });

  it("the steady test voice is a buzz, and the reasons say why", () => {
    const m = analyse(synthVowel(2, 24000), 24000);
    const { verdict, reasons } = classify(m);
    expect(verdict).toBe("buzz");
    expect(reasons).toHaveLength(2);
    expect(m.loudnessVariation).toBeLessThan(0.15);
    expect(m.spectralWanderHz).toBeLessThan(50);
  });

  it("loudness that moves is not enough: a wobbling tone with fixed timbre is still a buzz", () => {
    const m = analyse(wobblingTone(3, 24000), 24000);
    expect(m.loudnessVariation).toBeGreaterThan(0.2);
    const { verdict, reasons } = classify(m);
    expect(verdict).toBe("buzz");
    expect(reasons.join()).toMatch(/timbre/);
  });

  it("timbre that moves is not enough: speech flattened to constant loudness is still a buzz", () => {
    const { samples, sampleRate } = golden();
    const m = analyse(samples, sampleRate);
    const flat = { ...m, loudnessVariation: 0.05 };
    expect(classify(flat).verdict).toBe("buzz");
    expect(classify(flat).reasons.join()).toMatch(/loudness/);
  });

  it("silence is silence, not a buzz", () => {
    expect(classify(analyse(new Float32Array(24000), 24000)).verdict).toBe("silence");
    expect(classify(analyse(new Float32Array(0), 24000)).verdict).toBe("silence");
  });

  it("finds a pause inside the audio but not silence at the ends", () => {
    const { samples, sampleRate } = golden();
    const gap = new Float32Array(Math.round(0.5 * sampleRate));
    const cut = Math.round(samples.length / 2);
    const padded = new Float32Array(gap.length + samples.length + gap.length * 2);
    padded.set(gap, 0);
    padded.set(samples.subarray(0, cut), gap.length);
    // a half-second gap in the middle, plus one at each end
    padded.set(samples.subarray(cut), gap.length + cut + gap.length);
    const before = analyse(samples, sampleRate);
    const m = analyse(padded, sampleRate);
    const middle = m.pauses.filter((p) => p.endSec - p.startSec > 0.4);
    expect(middle).toHaveLength(1);
    expect(middle[0]!.startSec).toBeGreaterThan(0.5 + cut / sampleRate - 0.1);
    expect(m.pauses.length).toBe(before.pauses.length + 1); // the end gaps add none
    expect(m.longestPauseSec).toBeGreaterThan(0.4);
  });
});

describe("audio helpers", () => {
  it("round-trips a WAV within 16-bit precision", () => {
    const { samples, sampleRate } = golden();
    const back = decodeWav(encodeWav(samples, sampleRate));
    expect(back.sampleRate).toBe(sampleRate);
    expect(back.samples).toHaveLength(samples.length);
    expect(Math.abs(back.samples[5000]! - samples[5000]!)).toBeLessThan(1 / 32768);
  });

  it("refuses something that is not a WAV", () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a WAV/);
  });

  it("draws a valid PNG whose width follows the duration", () => {
    const { samples, sampleRate } = golden();
    const png = spectrogramPng(samples, sampleRate);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBeGreaterThan(300); // width
    expect(png.readUInt32BE(20)).toBeGreaterThan(100); // height
  });
});
