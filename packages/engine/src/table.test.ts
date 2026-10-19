import { describe, expect, it } from "vitest";
import { addToTranscript, cardFace, lineLabel, favourite, frameRow, layoutRow, lookYaw, MAX_LOOK, parseSeats, percent, seatFor, SUIT_PATHS } from "./table.ts";

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

describe("suit shapes (VIK-141)", () => {
  it("has a different drawn shape for each suit, and the club is three separate lobes where the spade is one point", () => {
    expect(new Set(Object.values(SUIT_PATHS)).size).toBe(4);
    expect(Object.keys(SUIT_PATHS).sort()).toEqual(["c", "d", "h", "s"]);
    expect((SUIT_PATHS.c!.match(/M/g) ?? []).length).toBe(4); // three lobes and a stem
    expect((SUIT_PATHS.s!.match(/M/g) ?? []).length).toBe(1); // one outline
  });
});

describe("cardFace", () => {
  it("reads the game's short names: rank and suit, with ten as 10 and hearts and diamonds red", () => {
    expect(cardFace("As")).toEqual({ text: "A♠", rank: "A", suit: "s", red: false, down: false });
    expect(cardFace("Td")).toEqual({ text: "10♦", rank: "10", suit: "d", red: true, down: false });
    expect(cardFace("7h")).toEqual({ text: "7♥", rank: "7", suit: "h", red: true, down: false });
    expect(cardFace("kc")).toEqual({ text: "K♣", rank: "K", suit: "c", red: false, down: false });
  });

  it("shows `back` face down, and a name it cannot read as it was sent", () => {
    expect(cardFace("back")).toMatchObject({ down: true });
    expect(cardFace("joker")).toMatchObject({ text: "joker", red: false, down: false });
  });
});

describe("addToTranscript", () => {
  it("adds a whole line, and grows a streamed one by its pieces", () => {
    let t = addToTranscript([], { id: "a", seat: "seat-1", text: "Raise." });
    t = addToTranscript(t, { id: "b", seat: "seat-2", delta: "I " });
    t = addToTranscript(t, { id: "b", seat: "seat-2", delta: "call" });
    expect(t).toEqual([
      { id: "a", seat: "seat-1", text: "Raise." },
      { id: "b", seat: "seat-2", text: "I call" },
    ]);
  });

  it("keeps the last few lines, and does not change the list it was given", () => {
    const first = [{ id: "a", seat: "s", text: "one" }];
    const t = ["b", "c", "d"].reduce((acc, id) => addToTranscript(acc, { id, seat: "s", text: id }), first);
    expect(t.map((l) => l.id)).toEqual(["b", "c", "d"]);
    expect(first).toEqual([{ id: "a", seat: "s", text: "one" }]);
  });
});

describe("lookYaw", () => {
  it("turns toward the speaker: positive for one to the right, negative for one to the left, none for oneself", () => {
    expect(lookYaw(0, 0.8)).toBeGreaterThan(0);
    expect(lookYaw(0.8, 0)).toBeLessThan(0);
    expect(lookYaw(0.5, 0.5)).toBe(0);
    expect(lookYaw(0, 0.8)).toBeCloseTo(-lookYaw(0.8, 0), 10);
  });

  it("turns further for a speaker further away, and never past a glance", () => {
    expect(lookYaw(0, 0.8)).toBeGreaterThan(lookYaw(0, 0.4));
    expect(lookYaw(0, 100)).toBe(MAX_LOOK);
  });
});

describe("percent and favourite (VIK-83)", () => {
  it("says a chance in whole percent, but never calls a live hand 0 or 100", () => {
    expect(percent(0.623)).toBe("62%");
    expect(percent(0.5)).toBe("50%");
    expect(percent(0)).toBe("0%");
    expect(percent(1)).toBe("100%");
    expect(percent(0.003)).toBe("<1%");
    expect(percent(0.997)).toBe(">99%");
  });

  it("marks the one seat in the lead, and nobody when there are no chances or the lead is shared", () => {
    expect(favourite([{ seat_id: "a", win: 0.2 }, { seat_id: "b", win: 0.7 }, { seat_id: "c", win: 0.1 }])).toBe("b");
    expect(favourite([{ seat_id: "a", win: 0.5 }, { seat_id: "b", win: 0.5 }])).toBeUndefined();
    expect(favourite([{ seat_id: "a" }, { seat_id: "b" }])).toBeUndefined();
    expect(favourite([{ seat_id: "a", win: 1 }, { seat_id: "b" }])).toBeUndefined(); // one chance alone says nothing about a lead
  });
});

describe("lines for one player (VIK-120)", () => {
  it("keeps who a line was for, whole or in pieces", () => {
    let t = addToTranscript([], { id: "a", seat: "seat-1", text: "Nice try.", to: "seat-2" });
    t = addToTranscript(t, { id: "b", seat: "seat-2", delta: "Thanks, " });
    t = addToTranscript(t, { id: "b", seat: "seat-2", delta: "Ada.", to: "seat-1" });
    expect(t).toEqual([
      { id: "a", seat: "seat-1", text: "Nice try.", to: "seat-2" },
      { id: "b", seat: "seat-2", text: "Thanks, Ada.", to: "seat-1" },
    ]);
    expect(addToTranscript([], { id: "c", seat: "seat-3", text: "Hi all." })).toEqual([{ id: "c", seat: "seat-3", text: "Hi all." }]);
  });

  it("is labelled with an arrow when there is an addressee, and by the speaker alone when the line is for the table", () => {
    const name = (s: string) => ({ "seat-1": "ada", "seat-2": "ben" })[s] ?? s;
    expect(lineLabel({ seat: "seat-1", to: "seat-2" }, name)).toBe("ada → ben");
    expect(lineLabel({ seat: "seat-1" }, name)).toBe("ada");
    expect(lineLabel({ seat: "seat-1", to: "seat-9" }, name)).toBe("ada → seat-9");
  });
});
