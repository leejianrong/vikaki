import { describe, expect, it } from "vitest";
import { denParts, merged, ROOM } from "./den.ts";

describe("the den (VIK-101)", () => {
  const { parts, lookTargets } = denParts();

  it("merges into one geometry with a colour on every vertex, so the whole room is one draw call", () => {
    const g = merged(parts.map((p) => ({ ...p, geometry: p.geometry.clone() })));
    expect(g.attributes.color!.count).toBe(g.attributes.position!.count);
    expect(g.index!.count / 3, "triangles in the room").toBeLessThan(9000);
  });

  it("has what a living room has: a window, shelves, pictures, a clock, plants, an armchair and a sofa", () => {
    const names = lookTargets.map((t) => t.name);
    for (const n of ["window", "bookcase", "pictures", "clock", "plant left", "plant right", "armchair", "sofa"]) expect(names).toContain(n);
  });

  it("keeps every look target inside the walls and above the floor", () => {
    for (const t of lookTargets) {
      expect(Math.abs(t.position.x), t.name).toBeLessThan(ROOM.side);
      expect(t.position.z, t.name).toBeGreaterThanOrEqual(ROOM.back);
      expect(t.position.z, t.name).toBeLessThan(ROOM.front);
      expect(t.position.y, t.name).toBeGreaterThan(0);
      expect(t.position.y, t.name).toBeLessThan(ROOM.height);
    }
  });
});
