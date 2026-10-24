import { describe, expect, it } from "vitest";
import { ArmActs, NO_OFFSETS, addArms } from "./arm-act.ts";
import { envelope, EXTRA_KINDS, extraPose, isExtra, LEAN_BACK } from "./extras.ts";

describe("extraPose", () => {
  it("starts and ends upright with the arms where they were, for every extra", () => {
    for (const kind of EXTRA_KINDS) for (const phase of [0, 1]) {
      const p = extraPose(kind, phase);
      expect(p.arms, `${kind} at ${phase}`).toEqual(NO_OFFSETS);
      expect(p.lean).toBe(0);
      expect(p.head.pitch).toBeCloseTo(0, 8);
    }
  });
  it("taps with the right hand only, lifting the forearm and not pushing it into the table", () => {
    const poses = Array.from({ length: 40 }, (_, i) => extraPose("tap", i / 40));
    for (const p of poses) {
      expect(p.arms.left).toEqual(NO_OFFSETS.left);
      expect(p.arms.right.down, "down is more positive: a smaller number lifts, never presses").toBeLessThanOrEqual(0);
    }
    expect(Math.min(...poses.map((p) => p.arms.right.down))).toBeLessThan(-0.05);
  });
  it("leans back with no arms, and a stretch leans back more with both arms up and the head tipped back", () => {
    const lean = extraPose("lean", 0.5);
    expect(lean.arms).toEqual(NO_OFFSETS);
    expect(lean.lean).toBe(1);
    const stretch = extraPose("stretch", 0.5);
    expect(stretch.arms.left).toEqual(stretch.arms.right);
    expect(stretch.arms.left.down, "arms up").toBeLessThan(-1.5);
    expect(stretch.head.pitch).toBeLessThan(0);
    expect(stretch.lean).toBeGreaterThan(0.5);
    expect(stretch.lean).toBeLessThan(1);
  });
  it("scratches with the right hand, which works at the head", () => {
    const a = extraPose("scratch", 0.45).arms;
    const b = extraPose("scratch", 0.5).arms;
    expect(a.left).toEqual(NO_OFFSETS.left);
    expect(a.right.down).toBeLessThan(-1);
    expect(a.right.elbow).not.toBe(b.right.elbow); // it moves while held
  });
  it("is smooth: no step bigger than a few hundredths of a radian between frames", () => {
    for (const kind of EXTRA_KINDS) {
      let last = extraPose(kind, 0);
      for (let i = 1; i <= 240; i++) {
        const p = extraPose(kind, i / 240);
        for (const side of ["left", "right"] as const) for (const n of ["forward", "down", "elbow"] as const) expect(Math.abs(p.arms[side][n] - last.arms[side][n]), `${kind} ${side} ${n}`).toBeLessThan(0.25);
        last = p;
      }
    }
  });
  it("leans no further than the cap", () => {
    expect(LEAN_BACK).toBeLessThan(0.5);
    for (const kind of EXTRA_KINDS) expect(extraPose(kind, 0.5).lean).toBeLessThanOrEqual(1);
  });
});

describe("envelope and isExtra", () => {
  it("goes up and down", () => {
    expect([envelope(0), envelope(0.5), envelope(1)]).toEqual([0, 1, 0]);
  });
  it("knows the extras from the other fidgets", () => {
    expect(isExtra("tap")).toBe(true);
    expect(isExtra("look")).toBe(false);
    expect(isExtra(undefined)).toBe(false);
  });
});

describe("ArmActs.extra", () => {
  it("layers an extra's arms on the rest, and lets go", () => {
    const arms = new ArmActs();
    const up = extraPose("stretch", 0.5).arms;
    arms.extra(up);
    expect(arms.update(0.016)).toEqual(addArms(NO_OFFSETS, up));
    arms.extra(undefined);
    expect(arms.update(0.016)).toEqual(NO_OFFSETS);
  });
});
