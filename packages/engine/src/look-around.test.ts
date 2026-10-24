import { describe, expect, it } from "vitest";
import { mulberry32 } from "./behaviour.ts";
import type { LookTarget } from "./den.ts";
import { chooseGlance, glanceAt, Glancer, type Glance } from "./look-around.ts";
import type { SeatSpot } from "./table3d.ts";

const spot: SeatSpot = { x: 0, z: -1.1, facing: 0 }; // on the far side, facing the camera (+z)
const head = { x: 0, y: 1.2, z: -1.1 };
const at = (name: string, x: number, y: number, z: number): LookTarget => ({ name, position: { x, y, z } });
const TARGETS = [at("sofa", 0, 0.6, 4.3), at("armchair", -2.5, 0.6, -1.3), at("plant", 2.3, 0.7, -1.2), at("clock", 0.8, 2.1, -2.4), at("lamp", 0, 2.2, 0)];

describe("glanceAt", () => {
  it("turns toward the target and not past the cap", () => {
    expect(glanceAt(spot, head, at("right", 3, 1.2, -0.5))!.yaw).toBeGreaterThan(0.3);
    expect(glanceAt(spot, head, at("left", -3, 1.2, -0.5))!.yaw).toBeLessThan(-0.3);
    expect(Math.abs(glanceAt(spot, head, at("right", 3, 1.2, -0.5))!.yaw)).toBeLessThanOrEqual(0.7);
  });
  it("looks up at something high (a negative pitch, since a nod is positive) and down at something low", () => {
    expect(glanceAt(spot, head, at("clock", 0.5, 2.4, 2))!.pitch).toBeLessThan(0);
    expect(glanceAt(spot, head, at("rug", 0.5, 0, 2))!.pitch).toBeGreaterThan(0);
  });
  it("cannot look at what is behind the seat", () => {
    expect(glanceAt(spot, head, at("clock", 0.8, 2.1, -2.4))).toBeUndefined();
  });
});

describe("chooseGlance", () => {
  const options: Glance[] = ["a", "b", "c", "d"].map((target, i) => ({ target, yaw: i * 0.1, pitch: 0 }));
  it("never repeats the last two while others are in reach, and over many picks uses every option", () => {
    const rng = mulberry32(5);
    const recent: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const g = chooseGlance(options, recent, rng)!;
      expect(recent).not.toContain(g.target);
      seen.add(g.target);
      recent.push(g.target);
      if (recent.length > 2) recent.shift();
    }
    expect(seen.size).toBe(4);
  });
  it("with one option, repeats it after a pause rather than glance at nothing", () => {
    expect(chooseGlance([options[0]!], ["a"], mulberry32(1))).toBeUndefined();
    expect(chooseGlance([options[0]!], [], mulberry32(1))!.target).toBe("a");
  });
});

describe("Glancer", () => {
  const make = (seed = 3) => new Glancer(mulberry32(seed), TARGETS, spot, head);

  it("knows which targets are in reach, and a seat with none has no look", () => {
    expect(make().any).toBe(true);
    expect(new Glancer(mulberry32(1), [at("clock", 0.8, 2.1, -2.4)], spot, head).any).toBe(false);
  });
  it("picks varied things, never one of the last two", () => {
    const g = make();
    const picks = Array.from({ length: 30 }, () => g.begin()!.target);
    expect(new Set(picks).size).toBe(2); // the sofa and the lamp: the plant and armchair are too far round, the clock behind
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]); // with two in reach, they alternate
  });
  it("can be held on a thing for a picture, and let go", () => {
    const g = make();
    expect(g.freeze("sofa")).toBe(true);
    expect(g.begin()?.target).toBe("sofa");
    expect(g.held?.target).toBe("sofa");
    expect(g.freeze("clock"), "the clock is behind the seat").toBe(false);
    g.freeze(undefined);
    expect(g.held).toBeUndefined();
  });
});
