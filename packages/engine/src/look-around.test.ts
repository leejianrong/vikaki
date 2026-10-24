import { describe, expect, it } from "vitest";
import { mulberry32 } from "./behaviour.ts";
import type { LookTarget } from "./den.ts";
import { chooseGlance, glanceAt, LookAround, type Glance } from "./look-around.ts";
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

describe("LookAround", () => {
  const run = (look: LookAround, seconds: number, ctx = { allowed: true, thinking: false }) => {
    const seen: (string | undefined)[] = [];
    for (let t = 0; t < seconds; t += 0.05) seen.push(look.update(0.05, ctx)?.target);
    return seen;
  };
  const make = (seed = 3, pace = 1) => new LookAround(mulberry32(seed), TARGETS, spot, head, pace);

  it("glances now and then, for about a second, and looks back", () => {
    const seen = run(make(), 60);
    const glances = seen.filter((s) => s !== undefined);
    expect(glances.length).toBeGreaterThan(20); // a second or so, several times
    expect(seen.some((s) => s === undefined)).toBe(true);
    expect(new Set(glances).size).toBeGreaterThan(1);
  });
  it("never glances while it may not (speaking, or looking at the speaker)", () => {
    expect(run(make(3, 0.1), 60, { allowed: false, thinking: false }).every((s) => s === undefined)).toBe(true);
  });
  it("glances more often while thinking", () => {
    const count = (thinking: boolean) => {
      const look = make(11);
      const seen = run(look, 120, { allowed: true, thinking });
      return seen.filter((s, i) => s !== undefined && seen[i - 1] === undefined).length;
    };
    expect(count(true)).toBeGreaterThan(count(false) * 1.5);
  });
  it("lets go the moment it may no longer glance", () => {
    const look = make(3, 0.05);
    let held = false;
    for (let t = 0; t < 30 && !held; t += 0.05) held = look.update(0.05, { allowed: true, thinking: false }) !== undefined;
    expect(held).toBe(true);
    expect(look.update(0.05, { allowed: false, thinking: false })).toBeUndefined();
  });
  it("can be held on a thing for a picture, and let go", () => {
    const look = make();
    expect(look.freeze("sofa")).toBe(true);
    expect(look.update(0.05, { allowed: false, thinking: false })?.target).toBe("sofa");
    expect(look.freeze("clock"), "the clock is behind the seat").toBe(false);
    look.freeze(undefined);
    expect(look.update(0.05, { allowed: true, thinking: false })).toBeUndefined();
  });
});
