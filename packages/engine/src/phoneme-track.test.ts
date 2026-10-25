import { describe, expect, it } from "vitest";
import { PhonemeTrack } from "./phoneme-track.ts";

const spans = [
  { p: "h", t: 0, d: 80 },
  { p: "ɛ", t: 80, d: 120, s: 1 as const },
  { p: "l", t: 260, d: 60 }, // a 60 ms gap before it
];

describe("PhonemeTrack", () => {
  it("puts a slice's phonemes on the page's clock and finds the one being spoken", () => {
    const t = new PhonemeTrack();
    t.add("u1", 1000, spans);
    expect(t.at(999)).toBeUndefined();
    expect(t.at(1000)?.p).toBe("h");
    expect(t.at(1100)).toMatchObject({ p: "ɛ", stress: 1 });
    expect(t.at(1220)).toBeUndefined(); // the gap
    expect(t.at(1300)?.p).toBe("l");
    expect(t.at(1320)).toBeUndefined();
  });

  it("answers from several slices and lines in time order, however they were added", () => {
    const t = new PhonemeTrack();
    t.add("u2", 5000, [{ p: "z", t: 0, d: 100 }]);
    t.add("u1", 1000, spans);
    expect(t.all().map((x) => x.utteranceId)).toEqual(["u1", "u1", "u1", "u2"]);
    expect(t.at(5050)?.p).toBe("z");
    expect(t.next(1300)?.p).toBe("z");
    expect(t.next(5200)).toBeUndefined();
  });

  it("forgets a cut-off line, and what is long past", () => {
    const t = new PhonemeTrack();
    t.add("u1", 1000, spans);
    t.add("u2", 9000, [{ p: "z", t: 0, d: 100 }]);
    t.clear("u1");
    expect(t.all().map((x) => x.p)).toEqual(["z"]);
    t.prune(20_000);
    expect(t.size).toBe(0);
  });

  it("counts what was ever added, even after it is forgotten", () => {
    const t = new PhonemeTrack();
    t.add("u1", 1000, spans);
    t.clear("u1");
    t.prune(99_999);
    expect(t.added).toBe(3);
    expect(t.size).toBe(0);
  });

  it("holds nothing for a slice with no phonemes", () => {
    const t = new PhonemeTrack();
    t.add("u1", 0, []);
    expect(t.size).toBe(0);
    expect(t.at(0)).toBeUndefined();
  });
});
