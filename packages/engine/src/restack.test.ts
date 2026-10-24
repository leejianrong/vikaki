import type { Mesh } from "three";
import { describe, expect, it, vi } from "vitest";
import { ArmActs, NO_OFFSETS, withReach } from "./arm-act.ts";
import { restackReach, restackSpots } from "./restack.ts";
import { chipPile, TableProps } from "./table-props.ts";
import { ovalSeats } from "./table3d.ts";

const across = { x: 1, z: 0 };
const pile = (amount: number) => chipPile(amount, 0, 0, across, 0.7);

describe("restackReach", () => {
  it("reaches in over the first fifth, holds, and goes back over the last", () => {
    expect(restackReach(0)).toBe(0);
    expect(restackReach(1)).toBe(0);
    expect(restackReach(0.5)).toBe(1);
    expect(restackReach(0.1)).toBeGreaterThan(0.2);
    expect(restackReach(0.1)).toBeLessThan(0.8);
  });
});

describe("restackSpots", () => {
  it("changes nothing at the ends", () => {
    const spots = pile(60);
    expect(restackSpots(spots, 0, across)).toBe(spots);
    expect(restackSpots(spots, 1, across)).toBe(spots);
  });
  it("lifts the top chip of the tallest column across to sit on the next column, and keeps every other chip where it is", () => {
    const spots = pile(63); // 2 blue (25), 2 red (5), 3 white (1): the white column is the tallest
    const tallest = Math.max(...[0, 1, 2, 3].map((k) => spots.filter((s) => s.kind === k).length));
    const moved = restackSpots(spots, 0.5, across);
    expect(moved).toHaveLength(spots.length);
    const changed = moved.filter((s, i) => s !== spots[i]);
    expect(changed.length).toBeLessThanOrEqual(2); // the top chip and the one under it
    const top = changed.find((s) => s.y > 0.7 + 0.016 * (tallest - 1));
    expect(top, "the top chip is lifted clear of its column").toBeDefined();
    expect(moved.map((s) => s.kind)).toEqual(spots.map((s) => s.kind)); // the same chips: only where they are drawn changes
  });
  it("slides the top chips aside when there is only one column", () => {
    const spots = pile(4);
    const moved = restackSpots(spots, 0.5, across);
    expect(moved.at(-1)!.x).toBeGreaterThan(spots.at(-1)!.x + 0.02);
  });
  it("never moves a chip through the table", () => {
    for (const amount of [3, 30, 63, 230]) for (let p = 0.05; p < 1; p += 0.05) for (const s of restackSpots(pile(amount), p, across)) expect(s.y).toBeGreaterThanOrEqual(0.7);
  });
});

describe("the left hand's reach", () => {
  it("adds a forward, down, elbow-in offset to the left arm only, and leaves an act in progress alone", () => {
    const r = withReach(NO_OFFSETS, 1, 0);
    expect(r.left.forward).toBeGreaterThan(0.2);
    expect(r.left.elbow).toBeLessThan(0);
    expect(r.right).toEqual(NO_OFFSETS.right);
    expect(withReach(NO_OFFSETS, 0, 0.5)).toBe(NO_OFFSETS);
  });
  it("is applied by the arms each update until let go", () => {
    const arms = new ArmActs();
    arms.reach(1);
    expect(arms.update(0.016).left.forward).toBeGreaterThan(0.2);
    arms.reach(0);
    expect(arms.update(0.016)).toEqual(NO_OFFSETS);
  });
});

describe("TableProps.setRestack", () => {
  const noop: unknown = new Proxy(() => noop, { get: (_, key) => (key === "measureText" ? () => ({ width: 10 }) : noop), set: () => true });
  it("riffles a seat's chips without changing how many there are, and puts them back", () => {
    vi.stubGlobal("Path2D", class {});
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const props = new TableProps(0.7, ovalSeats(3), ["a", "b", "c"]);
    props.setState({ protocol_version: 1, type: "table_state", hand_no: 1, street: "flop", seats: ["a", "b", "c"].map((id) => ({ seat_id: id, stack: 63, cards: ["back", "back"] })) } as Parameters<TableProps["setState"]>[0]);
    const chips = () => props.group.children.flatMap((c) => (c as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh ? [c] : []) as unknown as { count: number; instanceMatrix: { array: Float32Array } }[];
    const snapshot = () => chips().map((m) => Array.from(m.instanceMatrix.array.slice(0, m.count * 16)).join(","));
    const before = snapshot();
    const count = props.drawn.chips;
    props.setRestack(1, 0.5);
    expect(props.drawn.restacking[1]).toBe(true);
    expect(props.drawn.chips, "the same chips").toBe(count);
    expect(snapshot()).not.toEqual(before);
    props.setRestack(1, 0);
    expect(snapshot()).toEqual(before);
  });
});
