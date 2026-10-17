import { describe, expect, it } from "vitest";
import { buildTable, circleSeats, medianHeight, seatLookYaw } from "./table3d.ts";

describe("circleSeats", () => {
  it("puts three seats on the far half of the circle, the middle one straight ahead and all facing the middle of the table", () => {
    const [a, b, c] = circleSeats(3);
    expect(b!.x).toBeCloseTo(0, 6);
    expect(b!.z).toBeLessThan(0);
    expect(b!.facing).toBeCloseTo(0, 6); // faces +z, the camera
    expect(a!.x).toBeLessThan(0);
    expect(c!.x).toBeGreaterThan(0);
    expect(a!.facing).toBeGreaterThan(0); // the left seat turns toward +x, the middle
    for (const s of [a!, b!, c!]) expect(Math.hypot(s.x, s.z)).toBeCloseTo(0.95, 6);
  });

  it("keeps more seats inside the same arc, and one seat alone straight ahead", () => {
    const six = circleSeats(6);
    expect(six).toHaveLength(6);
    expect(Math.abs(six[0]!.x)).toBeLessThanOrEqual(0.95);
    expect(six[0]!.x).toBeCloseTo(-six[5]!.x, 6);
    expect(circleSeats(1)[0]!.x).toBeCloseTo(0, 6);
  });
});

describe("seatLookYaw", () => {
  const [left, mid, right] = circleSeats(3);

  it("turns each seat's head toward the speaker, left or right, and not at all at itself", () => {
    expect(seatLookYaw(mid!, left!)).toBeLessThan(0);
    expect(seatLookYaw(mid!, right!)).toBeGreaterThan(0);
    expect(seatLookYaw(mid!, mid!)).toBe(0);
  });

  it("is mirrored left to right, and capped", () => {
    expect(seatLookYaw(mid!, left!)).toBeCloseTo(-seatLookYaw(mid!, right!), 6);
    expect(Math.abs(seatLookYaw(left!, right!))).toBeLessThanOrEqual(0.6);
  });
});

describe("medianHeight", () => {
  it("is the middle value, so one odd avatar does not set the table height", () => {
    expect(medianHeight([0.7, 0.4, 0.72])).toBe(0.7);
    expect(medianHeight([0.5, 0.6])).toBeCloseTo(0.55, 8);
  });
});

describe("buildTable", () => {
  it("is a few meshes with the felt top at the asked height", () => {
    const t = buildTable(0.7);
    expect(t.children.length).toBeLessThanOrEqual(6);
    expect(t.children[0]!.position.y).toBeCloseTo(0.675, 6);
  });
});
