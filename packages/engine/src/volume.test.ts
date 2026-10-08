import { describe, expect, it } from "vitest";
import { rmsToVolume } from "./volume.ts";

describe("rmsToVolume", () => {
  it("is 0 for silence and for quiet room noise", () => {
    expect(rmsToVolume(0)).toBe(0);
    expect(rmsToVolume(0.001)).toBe(0); // log10 = -3, below the -2.5 floor
    expect(rmsToVolume(0.003)).toBe(0); // about -2.52
  });

  it("is 1 for loud speech and never above", () => {
    expect(rmsToVolume(0.0316)).toBeCloseTo(1, 1);
    expect(rmsToVolume(0.5)).toBe(1);
    expect(rmsToVolume(10)).toBe(1);
  });

  it("rises monotonically between the floor and the ceiling", () => {
    let prev = -1;
    for (const r of [0.004, 0.006, 0.01, 0.015, 0.02, 0.03]) {
      const v = rmsToVolume(r);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("survives NaN and negative input", () => {
    expect(rmsToVolume(Number.NaN)).toBe(0);
    expect(rmsToVolume(-1)).toBe(0);
  });
});
