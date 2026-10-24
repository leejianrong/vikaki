import { describe, expect, it } from "vitest";
import { ReactionMotion } from "./reaction.ts";

const run = (r: ReactionMotion, seconds: number, step = 1 / 60) => {
  const out: { pitch: number; yaw: number; roll: number }[] = [];
  for (let t = 0; t < seconds; t += step) out.push(r.update(step));
  return out;
};

describe("ReactionMotion", () => {
  it("is still until it is told something", () => {
    for (const s of run(new ReactionMotion(), 1)) expect(s).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  });

  it("nods twice: two dips of the head (positive pitch) and then rest", () => {
    const r = new ReactionMotion();
    r.play("nod");
    const pitch = run(r, 1.2).map((s) => s.pitch);
    const peaks = pitch.filter((p, i) => p > 0.05 && p >= (pitch[i - 1] ?? 0) && p >= (pitch[i + 1] ?? 0)).length;
    expect(peaks).toBeGreaterThanOrEqual(2);
    expect(Math.min(...pitch)).toBeGreaterThanOrEqual(0);
    expect(pitch.at(-1)).toBe(0);
  });

  it("shakes the head from side to side, and tilts it to one side", () => {
    const shake = new ReactionMotion();
    shake.play("shake");
    const yaw = run(shake, 1.2).map((s) => s.yaw);
    expect(Math.max(...yaw)).toBeGreaterThan(0.05);
    expect(Math.min(...yaw)).toBeLessThan(-0.05);
    expect(yaw.at(-1)).toBe(0);
    const tilt = new ReactionMotion();
    tilt.play("tilt");
    const roll = run(tilt, 1.5).map((s) => s.roll);
    expect(Math.max(...roll)).toBeGreaterThan(0.08);
    expect(roll.at(-1)).toBe(0);
  });

  it("eases toward whoever it is told to look at, holds there, and eases back when told to look ahead", () => {
    const r = new ReactionMotion();
    r.look(0.4);
    const toward = run(r, 2).map((s) => s.yaw);
    expect(toward[5]!).toBeGreaterThan(0);
    expect(toward[5]!).toBeLessThan(0.4); // not a snap
    expect(toward.at(-1)).toBeCloseTo(0.4, 2);
    r.look(0);
    expect(run(r, 2.5).at(-1)!.yaw).toBeCloseTo(0, 2);
  });

  it("moves a stalled frame on by a small step only, so a gesture is delayed and not skipped", () => {
    const r = new ReactionMotion();
    r.play("tilt");
    r.update(5); // the page stalled for five seconds
    expect(run(r, 0.6).some((s) => s.roll > 0.05)).toBe(true);
  });

  it("glances at the room on top of the turn toward a speaker, quicker than that turn, and looks back (VIK-102)", () => {
    const r = new ReactionMotion();
    r.glance({ yaw: 0.5, pitch: -0.2 });
    const out = run(r, 2);
    expect(out[10]!.yaw).toBeGreaterThan(0.2); // within a fraction of a second
    expect(out.at(-1)!.yaw).toBeCloseTo(0.5, 2);
    expect(out.at(-1)!.pitch).toBeCloseTo(-0.2, 2);
    r.look(0.3); // and a speaker turns it further
    expect(run(r, 2).at(-1)!.yaw).toBeCloseTo(0.8, 2);
    r.glance();
    r.look(0);
    const end = run(r, 2).at(-1)!;
    expect(end.yaw).toBeCloseTo(0, 2);
    expect(end.pitch).toBeCloseTo(0, 2);
  });
});
