import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeWav } from "../src/wav.ts";
import { opennessOf, scoreLine, vowelMatch, type MouthTrack } from "../src/scorecard.ts";

const RATE = 16000;

/** Bursts of a 200 Hz tone, 0.35 s on and 0.25 s off, behind 0.3 s of quiet at each end: a stand-in for syllables and the pauses between. */
function bursts(count = 5): { samples: Float32Array; envelope: (t: number) => number; seconds: number } {
  const lead = 0.3;
  const seconds = lead * 2 + count * 0.6;
  const samples = new Float32Array(Math.round(seconds * RATE));
  const on = (t: number) => {
    const u = t - lead;
    return u >= 0 && u < count * 0.6 && u % 0.6 < 0.35;
  };
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    samples[i] = on(t) ? 0.5 * Math.sin(2 * Math.PI * 200 * t) : 0;
  }
  return { samples, envelope: (t) => (on(t) ? 1 : 0), seconds };
}

/** A mouth that follows `f` at `fps` frames a second, from 0 to `seconds`. */
function mouth(seconds: number, fps: number, f: (t: number) => number): MouthTrack {
  const n = Math.round(seconds * fps) + 1;
  return { t: Float64Array.from({ length: n }, (_, i) => i / fps), open: Float64Array.from({ length: n }, (_, i) => f(i / fps)) };
}

/** The bursts' envelope, smoothed a little as a real mouth is, and arriving `delay` seconds late. */
const follows = (env: (t: number) => number, delay: number) => (t: number) => {
  let s = 0;
  for (let k = 0; k < 5; k++) s += env(t - delay - k * 0.01) / 5;
  return s * 0.8;
};

describe("opennessOf", () => {
  it("adds the five mouth shapes and stops at fully open", () => {
    expect(opennessOf([0, 0, 0, 0, 0])).toBe(0);
    expect(opennessOf([0.5, 0.25, 0, 0, 0])).toBeCloseTo(0.75);
    expect(opennessOf([1, 1, 1, 1, 1])).toBe(1);
  });
});

describe("scoreLine", () => {
  const a = bursts();

  it("gives a mouth that follows the sound a high match, its lag, a closed mouth in the quiet, a real range and no flutter", () => {
    const s = scoreLine(a.samples, RATE, mouth(a.seconds, 60, follows(a.envelope, 0.1)));
    expect(s.lagMs).toBeGreaterThanOrEqual(80);
    expect(s.lagMs).toBeLessThanOrEqual(120);
    expect(s.matchAtBestLag).toBeGreaterThan(0.9);
    expect(s.loudnessMatch).toBeLessThan(s.matchAtBestLag); // at zero lag it is a worse match than at its own lag
    expect(s.silenceClosure).toBeGreaterThan(0.95);
    expect(s.opennessRange).toBeGreaterThan(0.6);
    expect(s.jitter).toBeLessThan(0.06); // the bursts have sharp edges, so some change per frame is right
  });

  it("reads a mouth that is ahead of the sound as a negative lag", () => {
    const s = scoreLine(a.samples, RATE, mouth(a.seconds, 60, follows(a.envelope, -0.06)));
    expect(s.lagMs).toBeLessThanOrEqual(-40);
    expect(s.lagMs).toBeGreaterThanOrEqual(-80);
  });

  it("fails a mouth stuck open: no match, no closing in the quiet, no range", () => {
    const s = scoreLine(a.samples, RATE, mouth(a.seconds, 60, () => 0.8));
    expect(s.loudnessMatch).toBe(0);
    expect(s.silenceClosure).toBe(0);
    expect(s.opennessRange).toBeLessThan(0.01);
  });

  it("fails a mouth that never opens: it closes in the quiet, but there is no match and no range", () => {
    const s = scoreLine(a.samples, RATE, mouth(a.seconds, 60, () => 0));
    expect(s.silenceClosure).toBe(1);
    expect(s.loudnessMatch).toBe(0);
    expect(s.opennessRange).toBe(0);
  });

  it("measures flutter: a mouth that flaps every frame is far jumpier than one that follows the sound", () => {
    const smooth = scoreLine(a.samples, RATE, mouth(a.seconds, 60, follows(a.envelope, 0.05)));
    const flap = scoreLine(a.samples, RATE, mouth(a.seconds, 60, (t) => (Math.round(t * 60) % 2 === 0 ? 0.9 : 0.1)));
    expect(flap.jitter).toBeGreaterThan(0.5);
    expect(flap.jitter).toBeGreaterThan(smooth.jitter * 10);
  });

  it("copes with a page that draws few frames: 15 a second still finds the lag within a frame", () => {
    const s = scoreLine(a.samples, RATE, mouth(a.seconds, 15, follows(a.envelope, 0.1)));
    expect(Math.abs(s.lagMs - 100)).toBeLessThanOrEqual(70);
    expect(s.matchAtBestLag).toBeGreaterThan(0.7);
  });

  it("does not change what it was given, and says how long the line is", () => {
    const m = mouth(a.seconds, 60, follows(a.envelope, 0.1));
    const before = Float64Array.from(m.open);
    const s = scoreLine(a.samples, RATE, m);
    expect(Array.from(m.open)).toEqual(Array.from(before));
    expect(s.seconds).toBeCloseTo(a.seconds, 2);
  });

  it("refuses audio with no sound in it, and a mouth with no frames", () => {
    expect(() => scoreLine(new Float32Array(RATE), RATE, mouth(1, 60, () => 0))).toThrow(/no sound/);
    expect(() => scoreLine(a.samples, RATE, { t: new Float64Array(), open: new Float64Array() })).toThrow(/no mouth frames/);
  });
});

describe("scoreLine on a real recording", () => {
  // Kokoro saying "Hmm, I will call that bet." with 0.3 s of quiet either side, as the script plays it.
  const { samples: speech, sampleRate } = decodeWav(readFileSync(new URL("./fixtures/scorecard/line-2.wav", import.meta.url)));
  const pad = Math.round(0.3 * sampleRate);
  const samples = new Float32Array(speech.length + 2 * pad);
  samples.set(speech, pad);
  const seconds = samples.length / sampleRate;

  /** The recording's own loudness, 10 ms at a time: a mouth that follows it perfectly, `delay` seconds late. */
  function followsRecording(delay: number): MouthTrack {
    const hop = Math.round(0.01 * sampleRate);
    const rms: number[] = [];
    for (let at = 0; at + hop <= samples.length; at += hop) rms.push(Math.sqrt(samples.slice(at, at + hop).reduce((s, v) => s + v * v, 0) / hop));
    const top = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.95)]!;
    return { t: rms.map((_, i) => i * 0.01 + delay), open: rms.map((v) => Math.min(1, v / top)) };
  }

  it("scores a mouth that follows the recording's loudness as a match, closed in the quiet, with its range", () => {
    const s = scoreLine(samples, sampleRate, followsRecording(0));
    expect(s.seconds).toBeCloseTo(seconds, 3);
    expect(s.loudnessMatch).toBeGreaterThan(0.95);
    expect(Math.abs(s.lagMs)).toBeLessThanOrEqual(10);
    expect(s.silenceClosure).toBeGreaterThan(0.9);
    expect(s.opennessRange).toBeGreaterThan(0.5);
  });

  it("finds a 150 ms delay in real speech, and fails a mouth stuck open", () => {
    expect(scoreLine(samples, sampleRate, followsRecording(0.15)).lagMs).toBeGreaterThanOrEqual(130);
    expect(scoreLine(samples, sampleRate, followsRecording(0.15)).lagMs).toBeLessThanOrEqual(170);
    const stuck = scoreLine(samples, sampleRate, { t: [0, seconds], open: [0.8, 0.8] });
    expect(stuck.loudnessMatch).toBe(0);
    expect(stuck.silenceClosure).toBe(0);
  });
});

describe("vowelMatch (VIK-51)", () => {
  // shapes: aa ih ou ee oh. 100 frames a second for one second; the first 0.5 s is an "aa" mouth, the rest an "ou" mouth.
  const t = Array.from({ length: 100 }, (_, i) => i / 100);
  const shapes = t.map((x) => (x < 0.5 ? [0.9, 0, 0, 0, 0] : [0, 0, 0.8, 0, 0]));
  const expected = (p: string) => ({ a: 0, u: 2 })[p as "a" | "u"];

  it("counts a vowel as a hit when the mouth makes its shape, a miss when it makes another, and skips consonants and short sounds", () => {
    const spans = [
      { p: "a", t: 0, d: 400 }, // hit
      { p: "u", t: 100, d: 300 }, // the mouth is "aa" there: miss
      { p: "u", t: 550, d: 400 }, // hit
      { p: "s", t: 0, d: 400 }, // not a vowel
      { p: "a", t: 0, d: 40 }, // too short
    ];
    expect(vowelMatch({ t, shapes }, spans, expected)).toEqual({ hits: 2, vowels: 3 });
  });

  it("a shut mouth during a vowel is a miss, and a vowel with no frames is not counted", () => {
    const shut = { t, shapes: t.map(() => [0, 0, 0, 0.02, 0]) };
    expect(vowelMatch(shut, [{ p: "a", t: 0, d: 400 }], expected)).toEqual({ hits: 0, vowels: 1 });
    expect(vowelMatch({ t: [], shapes: [] }, [{ p: "a", t: 0, d: 400 }], expected)).toEqual({ hits: 0, vowels: 0 });
  });
});
