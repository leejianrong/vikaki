import { describe, expect, it } from "vitest";
import { frameFromEyeLevel } from "./framing.ts";

describe("frameFromEyeLevel", () => {
  it("puts the camera exactly at eye level", () => {
    expect(frameFromEyeLevel(1.55, 1.35, 1.75, 28).y).toBe(1.55);
  });

  it("keeps the whole head in view: top and chin both inside the half-height at that distance", () => {
    const eyeY = 1.55, headY = 1.35, topY = 1.75, fov = 28;
    const { distance } = frameFromEyeLevel(eyeY, headY, topY, fov);
    const visibleHalf = distance * Math.tan((fov * Math.PI) / 360);
    expect(visibleHalf).toBeGreaterThan(topY - eyeY);
    expect(visibleHalf).toBeGreaterThan(eyeY - headY);
  });

  it("moves further back for a taller head or a wider field of view change", () => {
    const small = frameFromEyeLevel(1.5, 1.4, 1.6, 28).distance;
    const big = frameFromEyeLevel(1.5, 1.2, 1.9, 28).distance;
    expect(big).toBeGreaterThan(small);
    expect(frameFromEyeLevel(1.5, 1.4, 1.6, 50).distance).toBeLessThan(small);
  });

  it("survives a degenerate head (zero height) without NaN or zero distance", () => {
    const f = frameFromEyeLevel(1.5, 1.5, 1.5, 28);
    expect(Number.isFinite(f.distance)).toBe(true);
    expect(f.distance).toBeGreaterThan(0);
  });
});
