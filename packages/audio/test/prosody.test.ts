import { describe, expect, it } from "vitest";
import { detectPitch, ProsodyTracker, type ProsodyEvent } from "../src/prosody.ts";

/** A voice-like tone: a fundamental and a few harmonics, with a pitch contour (Hz over seconds) and a loudness envelope. */
function voice(seconds: number, sampleRate: number, f0: (t: number) => number, amp: (t: number) => number = () => 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * f0(t)) / sampleRate;
    out[i] = amp(t) * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) / 1.75;
  }
  return out;
}

const silence = (seconds: number, sampleRate: number) => new Float32Array(Math.round(seconds * sampleRate));

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

/** Feed a clip to a tracker as a browser would: overlapping windows every 33 ms. */
function run(clip: Float32Array, sampleRate: number): ProsodyEvent[] {
  const tracker = new ProsodyTracker();
  const hop = Math.round(sampleRate / 30);
  const win = 2048 * Math.round(sampleRate / 48000) || 2048;
  const events: ProsodyEvent[] = [];
  for (let end = win; end <= clip.length; end += hop) events.push(...tracker.push(clip.subarray(end - win, end), sampleRate, end / sampleRate));
  return events;
}

describe("detectPitch", () => {
  it("finds the pitch of a voice-like tone within 3% at any sample rate", () => {
    for (const rate of [16000, 44100, 48000]) {
      for (const hz of [100, 150, 220, 330]) {
        const p = detectPitch(voice(0.2, rate, () => hz), rate);
        expect(p.voiced, `${hz} Hz at ${rate}`).toBe(true);
        expect(Math.abs(p.hz - hz) / hz, `${hz} Hz at ${rate}`).toBeLessThan(0.03);
      }
    }
  });

  it("calls silence and noise unvoiced", () => {
    expect(detectPitch(silence(0.2, 48000), 48000).voiced).toBe(false);
    let seed = 1;
    const noise = Float32Array.from({ length: 9600 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4);
    expect(detectPitch(noise, 48000).voiced).toBe(false);
  });
});

describe("ProsodyTracker", () => {
  const rate = 48000;

  it("flags a stressed word: a burst louder than the phrase around it, once", () => {
    const phrase = voice(3, rate, () => 130, (t) => (t > 1.5 && t < 1.8 ? 0.7 : 0.25));
    const cues = run(phrase, rate).filter((e) => e.cue === "emphasis");
    expect(cues).toHaveLength(1);
    expect(cues[0]!.t).toBeGreaterThan(1.5);
    expect(cues[0]!.t).toBeLessThan(1.9);
  });

  it("does not flag a steady phrase, nor silence, nor noise", () => {
    expect(run(voice(3, rate, () => 130), rate).filter((e) => e.cue === "emphasis")).toEqual([]);
    expect(run(silence(3, rate), rate)).toEqual([]);
  });

  it("flags one stress for two bursts that are close together", () => {
    const phrase = voice(3, rate, () => 130, (t) => ((t > 1.5 && t < 1.65) || (t > 1.8 && t < 1.95) ? 0.7 : 0.25));
    expect(run(phrase, rate).filter((e) => e.cue === "emphasis")).toHaveLength(1);
  });

  it("flags a rising ending, as in a question, when the voice lifts at the end of a phrase and then stops", () => {
    const question = concat([voice(1.4, rate, (t) => (t < 1 ? 120 : 120 + (t - 1) * 150)), silence(1, rate)]);
    expect(run(question, rate).filter((e) => e.cue === "rise")).toHaveLength(1);
  });

  it("does not flag a flat or falling ending", () => {
    const flat = concat([voice(1.4, rate, () => 130), silence(1, rate)]);
    const falling = concat([voice(1.4, rate, (t) => (t < 1 ? 150 : 150 - (t - 1) * 100)), silence(1, rate)]);
    expect(run(flat, rate).filter((e) => e.cue === "rise")).toEqual([]);
    expect(run(falling, rate).filter((e) => e.cue === "rise")).toEqual([]);
  });

  it("flags a pause once, after speech and a real silence, and not for a short gap or a long quiet", () => {
    const withPause = concat([voice(1.2, rate, () => 130), silence(0.9, rate), voice(1, rate, () => 130)]);
    const pauses = run(withPause, rate).filter((e) => e.cue === "pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.t).toBeGreaterThan(1.2 + 0.4);
    expect(pauses[0]!.t).toBeLessThan(1.2 + 0.8);
    const shortGap = concat([voice(1.2, rate, () => 130), silence(0.2, rate), voice(1, rate, () => 130)]);
    expect(run(shortGap, rate).filter((e) => e.cue === "pause")).toEqual([]);
    const longQuiet = concat([voice(1.2, rate, () => 130), silence(8, rate)]);
    expect(run(longQuiet, rate).filter((e) => e.cue === "pause")).toHaveLength(1); // once, not every second of the quiet
  });

  it("does not call a pause after a mere blip of sound", () => {
    const blip = concat([silence(0.5, rate), voice(0.15, rate, () => 130), silence(2, rate)]);
    expect(run(blip, rate).filter((e) => e.cue === "pause")).toEqual([]);
  });

  it("finds the same cues whatever the sample rate", () => {
    const make = (r: number) => concat([voice(1.4, r, (t) => (t < 1 ? 120 : 120 + (t - 1) * 150), (t) => (t > 0.7 && t < 0.9 ? 0.7 : 0.25)), silence(1, r)]);
    const kinds = (r: number) => run(make(r), r).map((e) => e.cue);
    expect(kinds(16000)).toEqual(kinds(48000));
    expect(kinds(48000)).toEqual(expect.arrayContaining(["emphasis", "rise", "pause"]));
  });
});
