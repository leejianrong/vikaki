import { describe, expect, it } from "vitest";
import { openness, toVisemeWeights } from "./viseme-map.ts";

describe("toVisemeWeights", () => {
  it("is all zero for zero volume", () => {
    const w = toVisemeWeights({ A: 1, I: 1, U: 1, E: 1, O: 1 }, 0);
    expect(Object.values(w).every((x) => x === 0)).toBe(true);
  });

  it("maps the Japanese vowel letters onto VRM mouth shapes", () => {
    const w = toVisemeWeights({ A: 0.1, I: 0.2, U: 0.3, E: 0.4, O: 0.5 }, 1);
    expect(w).toEqual({ aa: 0.1, ih: 0.2, ou: 0.3, ee: 0.4, oh: 0.5 });
  });

  it("scales by volume", () => {
    expect(toVisemeWeights({ A: 0.8 }, 0.5).aa).toBeCloseTo(0.4);
  });

  it("clamps to [0, 1] and survives NaN, negative and out-of-range input", () => {
    const w = toVisemeWeights({ A: 5, I: -2, U: Number.NaN }, 3);
    expect(w.aa).toBe(1);
    expect(w.ih).toBe(0);
    expect(w.ou).toBe(0);
  });

  it("ignores phoneme keys it does not know", () => {
    const w = toVisemeWeights({ A: 0.5, N: 0.9, "-": 0.9 }, 1);
    expect(Object.keys(w).sort()).toEqual(["aa", "ee", "ih", "oh", "ou"]);
  });
});

describe("openness", () => {
  it("is the strongest weight, and 0 for an empty set", () => {
    expect(openness({ aa: 0.2, oh: 0.7 })).toBe(0.7);
    expect(openness({})).toBe(0);
  });
});
