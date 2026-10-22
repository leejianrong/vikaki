import { describe, expect, it } from "vitest";
import { gridInterval, gridLayout } from "./pov-grid.ts";

describe("gridLayout", () => {
  it("gives three players three tiles inside the area that do not overlap", () => {
    for (const [w, h] of [[770, 620], [1100, 620], [500, 700], [1600, 400]] as const) {
      const tiles = gridLayout(3, w, h);
      expect(tiles).toHaveLength(3);
      for (const t of tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(w + 1);
        expect(t.y + t.height).toBeLessThanOrEqual(h + 1);
      }
      for (let i = 0; i < 3; i++)
        for (let j = i + 1; j < 3; j++) {
          const a = tiles[i]!;
          const b = tiles[j]!;
          expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${i} and ${j} at ${w}x${h}`).toBe(true);
        }
    }
  });

  it("puts a wide area in a row and a tall one in a column, and centres a short last row", () => {
    expect(new Set(gridLayout(3, 1800, 400).map((t) => t.y)).size).toBe(1);
    expect(new Set(gridLayout(3, 400, 1500).map((t) => t.x)).size).toBe(1);
    const two = gridLayout(3, 800, 800); // two columns and a lone tile in the second row
    expect(two[2]!.x).toBeGreaterThan(0);
    expect(two[2]!.x + two[2]!.width / 2).toBeCloseTo(400, -1);
  });

  it("handles one player, none, and six", () => {
    expect(gridLayout(0, 100, 100)).toEqual([]);
    expect(gridLayout(1, 800, 600)).toEqual([{ x: 0, y: 0, width: 800, height: 600 }]);
    expect(gridLayout(6, 1200, 700)).toHaveLength(6);
  });
});

describe("gridInterval", () => {
  it("draws the grid less often the slower the frames are, and never less than every twelfth", () => {
    expect(gridInterval(10)).toBe(2);
    expect(gridInterval(40)).toBeGreaterThan(gridInterval(10));
    expect(gridInterval(120)).toBeGreaterThan(gridInterval(40));
    expect(gridInterval(5000)).toBe(12);
  });
});
