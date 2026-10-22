import { describe, expect, it } from "vitest";
import { ACT_SECONDS, actFor, ArmActs, armOffsets, NO_OFFSETS } from "./arm-act.ts";

describe("actFor", () => {
  it("knocks for a check, pushes for a call, bet or raise, tosses for a fold, and does nothing for the rest", () => {
    expect(["check", "call", "bet", "raise", "fold"].map(actFor)).toEqual(["knock", "push", "push", "push", "toss"]);
    expect(["new_hand", "street", "win", "showdown"].map(actFor)).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("armOffsets", () => {
  it("starts and ends at rest, and moves in between", () => {
    for (const act of ["knock", "push", "toss"] as const) {
      expect(armOffsets(act, 0)).toEqual(NO_OFFSETS);
      expect(armOffsets(act, 1).right.down).toBeCloseTo(0);
      const mid = armOffsets(act, 0.25);
      expect(Math.abs(mid.right.forward) + Math.abs(mid.right.down) + Math.abs(mid.right.elbow)).toBeGreaterThan(0.1);
    }
  });

  it("knocks twice: the arm is up twice and down between", () => {
    const up = (p: number) => Math.abs(armOffsets("knock", p).right.elbow);
    expect(up(0.25)).toBeGreaterThan(0.4);
    expect(up(0.5)).toBeLessThan(0.05);
    expect(up(0.75)).toBeGreaterThan(0.4);
  });

  it("pushes with both hands and tosses and knocks with the right one only", () => {
    expect(armOffsets("push", 0.5).left.forward).toBeGreaterThan(0.2);
    expect(armOffsets("toss", 0.5).left).toEqual(NO_OFFSETS.left);
    expect(armOffsets("knock", 0.25).left).toEqual(NO_OFFSETS.left);
  });
});

describe("ArmActs", () => {
  it("plays an act through and then rests, and a stalled frame only advances it a little", () => {
    const arms = new ArmActs();
    expect(arms.update(0.016)).toEqual(NO_OFFSETS);
    arms.play("push");
    expect(arms.playing).toBe("push");
    expect(arms.update(5).right.forward).toBeLessThan(0.1); // one huge frame moves it 50 ms, not to the end
    expect(arms.playing).toBe("push");
    for (let t = 0; t < ACT_SECONDS.push + 0.2; t += 0.05) arms.update(0.05);
    expect(arms.playing).toBeUndefined();
    expect(arms.update(0.05)).toEqual(NO_OFFSETS);
  });
});
