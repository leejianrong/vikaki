import { describe, expect, it } from "vitest";
import { parseDeck, PIPS } from "./card-art.ts";

describe("parseDeck", () => {
  it("is clean unless classic is asked for", () => {
    expect(parseDeck(null)).toBe("clean");
    expect(parseDeck("")).toBe("clean");
    expect(parseDeck("fancy")).toBe("clean");
    expect(parseDeck("classic")).toBe("classic");
  });
});

describe("the pips of a classic card", () => {
  it("are as many as the rank, an ace has one, and every one is inside the pip field", () => {
    for (let n = 2; n <= 10; n++) expect(PIPS[String(n)]).toHaveLength(n);
    expect(PIPS.A).toHaveLength(1);
    for (const spots of Object.values(PIPS)) for (const [x, y] of spots) expect(x >= 0 && x <= 1 && y >= 0 && y <= 1).toBe(true);
  });

  it("are laid out the way a deck does: left-right symmetric, and the lower half turned over", () => {
    for (const [rank, spots] of Object.entries(PIPS)) {
      const seen = new Set(spots.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`));
      for (const [x, y] of spots) expect(seen.has(`${(1 - x).toFixed(3)},${y.toFixed(3)}`), `${rank} at ${x},${y}`).toBe(true);
    }
    expect(PIPS["10"]!.filter(([, y]) => y > 0.5)).toHaveLength(5); // five a half
  });
});
