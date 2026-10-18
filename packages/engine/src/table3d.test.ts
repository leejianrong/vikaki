import { describe, expect, it } from "vitest";
import { buildTable, medianHeight, onFelt, ovalSeats, RAIL, SEAT_OFFSET, seatLookYaw, TABLE_A, TABLE_B } from "./table3d.ts";

describe("ovalSeats", () => {
  it("puts three seats on the far long side of the table: left, middle, right, all facing in", () => {
    const [a, b, c] = ovalSeats(3);
    expect(b!.x).toBeCloseTo(0, 6);
    expect(b!.z).toBeLessThan(0);
    expect(b!.facing).toBeCloseTo(0, 6); // the middle seat faces +z, the camera
    expect(a!.x).toBeLessThan(0);
    expect(c!.x).toBeGreaterThan(0);
    expect(a!.x).toBeCloseTo(-c!.x, 6);
    expect(a!.facing).toBeGreaterThan(0); // the left seat turns toward +x, the middle
    expect(c!.facing).toBeCloseTo(-a!.facing, 6);
    expect(a!.facing).toBeLessThan(0.9); // but looks across the rail, not at the middle of the table
  });

  it("keeps every seat behind the rail and off the felt, a seat's width from the next, for 1 to 8 players", () => {
    for (let n = 1; n <= 8; n++) {
      const seats = ovalSeats(n);
      expect(seats).toHaveLength(n);
      for (const [i, s] of seats.entries()) {
        expect(onFelt(s.x, s.z, -(RAIL + SEAT_OFFSET) * 0.9), `${n} seats: seat ${i} is behind the rail`).toBe(false);
        const next = seats[i + 1];
        if (next) expect(Math.hypot(s.x - next.x, s.z - next.z), `${n} seats: seats ${i} and ${i + 1}`).toBeGreaterThan(n === 1 ? 0 : 0.9);
      }
    }
  });

  it("gives three players clearly more room than the circle did (0.95 m apart): at least 1.1 m between neighbours", () => {
    const [a, b, c] = ovalSeats(3);
    expect(Math.hypot(a!.x - b!.x, a!.z - b!.z)).toBeGreaterThan(1.1);
    expect(Math.hypot(c!.x - b!.x, c!.z - b!.z)).toBeGreaterThan(1.1);
  });

  it("is longer than it is wide, and the felt test follows the oval", () => {
    expect(TABLE_A).toBeGreaterThan(TABLE_B * 1.6);
    expect(onFelt(0, 0)).toBe(true);
    expect(onFelt(TABLE_A - 0.2, 0)).toBe(true);
    expect(onFelt(0, TABLE_B - 0.2)).toBe(true);
    expect(onFelt(TABLE_A - 0.2, TABLE_B - 0.2)).toBe(false); // the corner of the bounding box is off the oval
    expect(onFelt(TABLE_A + 0.1, 0)).toBe(false);
  });

  it("goes round the whole oval for five or more, with some seats on the near side", () => {
    const six = ovalSeats(6);
    expect(six.some((s) => s.z > 0) && six.some((s) => s.z < 0)).toBe(true);
    expect(six[0]!.z).toBeLessThan(0); // the first is on the far side, far left
    expect(six[0]!.x).toBeLessThan(0);
  });
});

describe("seatLookYaw", () => {
  const [left, mid, right] = ovalSeats(3);

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
