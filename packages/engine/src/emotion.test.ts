import { describe, expect, it } from "vitest";
import { EMOTIONS } from "@vikaki/protocol";
import { EMOTION_PRESETS, EmotionState, NEUTRAL_POSE, poseFor, SETTLE_SECONDS, type EmotionPose } from "./emotion.ts";

const numeric = (p: EmotionPose) => [p.squint, p.pitch, p.roll, p.yaw, p.shake, p.bob, p.symbolAmount, ...Object.values(p.rest)];

describe("emotion presets", () => {
  it("has a preset for each of the seven emotions, and neutral changes nothing", () => {
    expect(Object.keys(EMOTION_PRESETS).sort()).toEqual([...EMOTIONS].sort());
    expect(poseFor("neutral", 1)).toEqual(NEUTRAL_POSE);
  });

  it("scales linearly with intensity", () => {
    const full = poseFor("happy", 1);
    const half = poseFor("happy", 0.5);
    expect(half.squint).toBeCloseTo(full.squint / 2, 10);
    expect(half.rest.ee).toBeCloseTo((full.rest.ee ?? 0) / 2, 10);
    expect(half.roll).toBeCloseTo(full.roll / 2, 10);
    expect(poseFor("happy", 0)).toEqual(NEUTRAL_POSE);
  });

  it("clamps intensity to [0, 1]", () => {
    expect(poseFor("sad", 3)).toEqual(poseFor("sad", 1));
    expect(poseFor("sad", -2)).toEqual(NEUTRAL_POSE);
    expect(poseFor("sad", Number.NaN)).toEqual(poseFor("sad", 1)); // an unusable intensity means "as asked", not none
  });

  it("falls back to neutral for an unknown emotion", () => {
    expect(poseFor("blorp", 1)).toEqual(NEUTRAL_POSE);
    expect(poseFor(undefined, 1)).toEqual(NEUTRAL_POSE);
  });

  it("keeps every preset small enough for a friendly face: eyelids never fully shut, mouth shapes within [0, 1]", () => {
    for (const e of EMOTIONS) {
      const p = poseFor(e, 1);
      expect(p.squint).toBeLessThanOrEqual(0.7);
      for (const v of Object.values(p.rest)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("gives each non-neutral emotion its own symbol, and neutral none", () => {
    const symbols = EMOTIONS.map((e) => poseFor(e, 1).symbol);
    expect(poseFor("neutral", 1).symbol).toBeNull();
    const used = symbols.filter((s) => s !== null);
    expect(new Set(used).size).toBe(used.length);
    expect(used).toHaveLength(EMOTIONS.length - 1);
  });
});

describe("EmotionState", () => {
  const settle = (s: EmotionState, seconds: number, step = 1 / 60) => {
    let pose = s.pose;
    for (let t = 0; t < seconds; t += step) pose = s.update(step);
    return pose;
  };

  it("eases to the preset and is within 0.05 of it one second later", () => {
    for (const e of EMOTIONS) {
      const s = new EmotionState();
      s.set(e, 1);
      const got = numeric(settle(s, 1));
      const want = numeric(poseFor(e, 1));
      got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThan(0.05));
    }
  });

  it("swaps one emotion's symbol for another's well within a second", () => {
    for (const from of EMOTIONS) {
      for (const to of EMOTIONS) {
        const s = new EmotionState();
        s.set(from, 1);
        settle(s, 2);
        s.set(to, 0.6);
        const pose = settle(s, 1);
        const want = poseFor(to, 0.6);
        expect(pose.symbol, `${from} to ${to}`).toBe(want.symbol);
        expect(Math.abs(pose.symbolAmount - want.symbolAmount), `${from} to ${to}`).toBeLessThan(0.05);
      }
    }
  });

  it("does not jump: the first frame moves only part of the way", () => {
    const s = new EmotionState();
    s.set("sad", 1);
    const first = s.update(1 / 60);
    expect(first.pitch).toBeGreaterThan(0);
    expect(first.pitch).toBeLessThan(poseFor("sad", 1).pitch / 2);
  });

  it("arrives at the same place whatever the frame rate", () => {
    const a = new EmotionState();
    const b = new EmotionState();
    a.set("happy", 1);
    b.set("happy", 1);
    const slow = settle(a, 0.5, 1 / 15);
    const fast = settle(b, 0.5, 1 / 120);
    expect(Math.abs(slow.squint - fast.squint)).toBeLessThan(0.01);
  });

  it("returns to neutral after being released, and not before", () => {
    const s = new EmotionState();
    s.set("angry", 1);
    settle(s, 1);
    s.release(0.5);
    expect(settle(s, 0.3).squint).toBeGreaterThan(poseFor("angry", 1).squint * 0.9); // still held
    expect(Math.abs(settle(s, 1.5).squint)).toBeLessThan(0.05);
  });

  it("a new emotion cancels a pending release", () => {
    const s = new EmotionState();
    s.set("happy", 1);
    s.release(0.2);
    s.set("smug", 1);
    expect(settle(s, 1.5).squint).toBeGreaterThan(poseFor("smug", 1).squint * 0.9);
  });

  it("reports the emotion and intensity it was given, with an unknown name as neutral", () => {
    const s = new EmotionState();
    s.set("blorp", 0.7);
    expect(s.emotion).toBe("neutral");
    s.set("smug", 0.4);
    expect(s).toMatchObject({ emotion: "smug", intensity: 0.4 });
  });

  it("settles within the documented time", () => {
    expect(SETTLE_SECONDS).toBeLessThanOrEqual(1);
  });
});
