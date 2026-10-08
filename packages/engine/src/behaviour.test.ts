import { describe, expect, it } from "vitest";
import { BLINK_INTERVAL, BLINK_SECONDS, Blinker, idlePose, MAX_IDLE_ANGLE, mulberry32 } from "./behaviour.ts";

/** Run a Blinker for `seconds` at 60 fps and return the times each blink started. */
function blinkStarts(seed: number, seconds: number, fps = 60): { starts: number[]; peak: number; returns: number; openFraction: number } {
  const b = new Blinker(mulberry32(seed));
  const dt = 1 / fps;
  const starts: number[] = [];
  let prev = 0, peak = 0, returns = 0, openFrames = 0;
  const frames = seconds * fps;
  for (let i = 0; i < frames; i++) {
    const v = b.update(dt);
    if (prev === 0 && v > 0) starts.push(i * dt);
    if (prev > 0 && v === 0) returns += 1;
    if (v === 0) openFrames += 1;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
    peak = Math.max(peak, v);
    prev = v;
  }
  return { starts, peak, returns, openFraction: openFrames / frames };
}

describe("Blinker", () => {
  it("is deterministic for a given seed and differs between seeds", () => {
    expect(blinkStarts(1, 60).starts).toEqual(blinkStarts(1, 60).starts);
    expect(blinkStarts(1, 60).starts).not.toEqual(blinkStarts(2, 60).starts);
  });

  it("blinks again 3 to 5 seconds after the previous blink ended, over many seeds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { starts } = blinkStarts(seed, 120);
      expect(starts.length).toBeGreaterThan(20);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i]! - starts[i - 1]! - BLINK_SECONDS;
        expect(gap).toBeGreaterThanOrEqual(BLINK_INTERVAL.min - 0.05);
        expect(gap).toBeLessThanOrEqual(BLINK_INTERVAL.max + 0.05);
      }
    }
  });

  it("blinks at least twice within 10 seconds from load, for every seed", () => {
    // Worst case: first blink at 3 s, then BLINK_SECONDS, then a 5 s gap, so about 8.2 s.
    for (let seed = 1; seed <= 200; seed++) expect(blinkStarts(seed, 10).starts.length).toBeGreaterThanOrEqual(2);
  });

  it("fully closes at any frame rate from 3 to 144 fps, stays within [0, 1], and every blink reopens", () => {
    for (const fps of [3, 5, 12, 30, 60, 144]) {
      for (let seed = 1; seed <= 20; seed++) {
        const { starts, peak, returns, openFraction } = blinkStarts(seed, 30, fps);
        expect(peak).toBe(1);
        // Every blink returns to fully open; the last one may still be in progress when sampling stops.
        expect(returns).toBeGreaterThanOrEqual(starts.length - 1);
        // Eyes are open most of the time. At 3 to 5 fps a blink spans whole frames, so the
        // frame-counted fraction is coarse; the guarantees there are the peak and the reopening.
        if (fps >= 12) expect(openFraction).toBeGreaterThan(0.9);
        else expect(openFraction).toBeGreaterThan(0.8);
      }
    }
  });
});

describe("idlePose", () => {
  it("stays small and finite over ten minutes", () => {
    for (let t = 0; t < 600; t += 0.1) {
      const p = idlePose(t);
      for (const a of [p.yaw, p.pitch, p.roll]) {
        expect(Number.isFinite(a)).toBe(true);
        expect(Math.abs(a)).toBeLessThanOrEqual(MAX_IDLE_ANGLE);
      }
    }
  });

  it("actually moves", () => {
    expect(idlePose(0)).not.toEqual(idlePose(2));
  });
});
