import { describe, expect, it } from "vitest";
import { InstancedMesh } from "three";
import { chipCounts, chipPile, MAX_COLUMN, seatSlots, TableProps } from "./table-props.ts";
import { circleSeats } from "./table3d.ts";

describe("chipCounts", () => {
  it("makes an amount from the biggest chips down, richest first (black 100, blue 25, red 5, white 1)", () => {
    expect(chipCounts(98)).toEqual([0, 3, 4, 3]);
    expect(chipCounts(230)).toEqual([2, 1, 1, 0]);
    expect(chipCounts(0)).toEqual([0, 0, 0, 0]);
  });

  it("caps a column, so a huge stack is a tall tower and not a thousand meshes, and ignores nonsense", () => {
    expect(chipCounts(1_000_000)[0]).toBe(MAX_COLUMN);
    expect(chipCounts(-5)).toEqual([0, 0, 0, 0]);
    expect(chipCounts(7.9)).toEqual([0, 0, 1, 2]);
  });
});

describe("chipPile", () => {
  it("stands each colour in its own column, chips one on top of the next, centred on the spot", () => {
    const spots = chipPile(30, 1, 2, { x: 1, z: 0 }, 0.7); // 1 blue (25) and 1 red (5)
    expect(spots).toHaveLength(2);
    expect(spots[0]!.x + spots[1]!.x).toBeCloseTo(2, 8); // symmetric about x = 1
    expect(spots.every((s) => s.z === 2)).toBe(true);
    const tall = chipPile(3, 0, 0, { x: 1, z: 0 }, 0); // three white chips in one column
    expect(tall.map((s) => s.x)).toEqual([0, 0, 0]);
    expect(tall[1]!.y).toBeGreaterThan(tall[0]!.y);
  });
});

describe("seatSlots", () => {
  it("puts a seat's cards between it and the middle, and the bet closer to the middle than the stack", () => {
    const [, mid] = circleSeats(3);
    const s = seatSlots(mid!);
    expect(Math.hypot(s.cards[0]!.x, s.cards[0]!.z)).toBeLessThan(Math.hypot(mid!.x, mid!.z));
    expect(Math.hypot(s.bet.x, s.bet.z)).toBeLessThan(Math.hypot(s.stack.x, s.stack.z));
    expect(s.cards[0]!.x).toBeLessThan(s.cards[1]!.x); // a pair side by side
  });

  it("keeps the dealer button and the stack on opposite sides of the cards", () => {
    const [, mid] = circleSeats(3);
    const s = seatSlots(mid!);
    expect(Math.sign(s.button.x - s.cards[0]!.x)).not.toBe(Math.sign(s.stack.x - s.cards[0]!.x));
  });
});

describe("TableProps", () => {
  it("never frustum-culls the chip meshes: an instanced mesh takes its bounding sphere while empty and would vanish for good", () => {
    const props = new TableProps(0.7, circleSeats(3), ["a", "b", "c"]);
    const chips = props.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    expect(chips).toHaveLength(4);
    expect(chips.every((c) => !c.frustumCulled)).toBe(true);
  });
});
