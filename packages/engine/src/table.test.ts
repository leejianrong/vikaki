import { describe, expect, it } from "vitest";
import { frameRow, layoutRow, parseSeats, seatFor } from "./table.ts";

describe("parseSeats", () => {
  it("a number makes that many seats, named seat-1 to seat-N, with the hub's personas in order", () => {
    expect(parseSeats("3", ["ada", "ben", "cy"])).toEqual([
      { seat: "seat-1", persona: "ada" },
      { seat: "seat-2", persona: "ben" },
      { seat: "seat-3", persona: "cy" },
    ]);
  });

  it("a number with fewer personas than seats reuses them in turn, and with none leaves the seats without a persona", () => {
    expect(parseSeats("3", ["ada", "ben"]).map((s) => s.persona)).toEqual(["ada", "ben", "ada"]);
    expect(parseSeats("2", [])).toEqual([{ seat: "seat-1" }, { seat: "seat-2" }]);
  });

  it("seat:persona pairs name the seats, and bare names are personas for seat-1, seat-2, ...", () => {
    expect(parseSeats("north:ada,south:ben", ["ada", "ben"])).toEqual([
      { seat: "north", persona: "ada" },
      { seat: "south", persona: "ben" },
    ]);
    expect(parseSeats("ada,ben", ["ada", "ben"])).toEqual([
      { seat: "seat-1", persona: "ada" },
      { seat: "seat-2", persona: "ben" },
    ]);
  });

  it("names the persona the hub lacks, and lists the ones it has", () => {
    expect(() => parseSeats("ada,zed", ["ada", "ben"])).toThrow(/no persona "zed".*ada, ben/);
  });

  it("refuses no seats, too many, a seat twice and nonsense", () => {
    expect(() => parseSeats("0", [])).toThrow(/between 1 and 8/);
    expect(() => parseSeats("9", [])).toThrow(/between 1 and 8/);
    expect(() => parseSeats("", [])).toThrow();
    expect(() => parseSeats("a:ada,a:ben", ["ada", "ben"])).toThrow(/twice/);
    expect(() => parseSeats("-2", [])).toThrow();
  });
});

describe("seatFor", () => {
  const seats = [
    { seat: "north", persona: "ada" },
    { seat: "south", persona: "ben" },
  ];
  it("finds a line's seat by its seat id first, then by its persona, else none", () => {
    expect(seatFor(seats, { seat: "south", persona: "ada" })).toBe(1);
    expect(seatFor(seats, { seat: "elsewhere", persona: "ada" })).toBe(0);
    expect(seatFor(seats, { persona: "ben" })).toBe(1);
    expect(seatFor(seats, { seat: "elsewhere" })).toBeUndefined();
    expect(seatFor(seats, undefined)).toBeUndefined();
  });
});

describe("layoutRow", () => {
  it("centres the row on zero with a gap between neighbours", () => {
    const xs = layoutRow([1, 1, 1], 0.2);
    expect(xs[1]).toBeCloseTo(0);
    expect(xs[2]! - xs[1]!).toBeCloseTo(1.2);
    expect(xs[0]).toBeCloseTo(-xs[2]!);
  });

  it("gives each avatar room for its own width, so a wide one does not overlap its neighbour", () => {
    const xs = layoutRow([0.6, 1.4], 0.1);
    expect(xs[1]! - xs[0]!).toBeCloseTo(0.6 / 2 + 0.1 + 1.4 / 2);
  });

  it("one avatar sits at zero", () => {
    expect(layoutRow([0.8], 0.2)).toEqual([0]);
  });
});

describe("frameRow", () => {
  const base = { eyeY: 1.4, headY: 1.25, topY: 1.7, fov: 28 };

  it("stays at the eye line, centred, so the camera never looks up or down", () => {
    const f = frameRow({ ...base, spanWidth: 2, aspect: 1.5 });
    expect(f.y).toBe(1.4);
  });

  it("backs off for a wide row on a narrow canvas, until the whole row is in view", () => {
    const f = frameRow({ ...base, spanWidth: 6, aspect: 1.5 });
    const visibleHalfWidth = f.distance * Math.tan((base.fov * Math.PI) / 360) * 1.5;
    expect(visibleHalfWidth).toBeGreaterThan(3);
  });

  it("backs off further on a taller canvas, because less width fits", () => {
    const wide = frameRow({ ...base, spanWidth: 4, aspect: 2 });
    const tall = frameRow({ ...base, spanWidth: 4, aspect: 0.6 });
    expect(tall.distance).toBeGreaterThan(wide.distance);
  });

  it("for one narrow avatar is the same as framing the head alone", () => {
    const f = frameRow({ ...base, spanWidth: 0.4, aspect: 2 });
    const alone = Math.max(1.7 - 1.4, 1.4 - 1.25) * 1.45 / Math.tan((28 * Math.PI) / 360);
    expect(f.distance).toBeCloseTo(alone);
  });
});
