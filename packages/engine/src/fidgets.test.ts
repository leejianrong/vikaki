import { describe, expect, it } from "vitest";
import { mulberry32 } from "./behaviour.ts";
import { candidates, FIDGET_KINDS, FidgetScheduler, gap, type FidgetCaps, type FidgetContext, type FidgetKind } from "./fidgets.ts";

const all: FidgetCaps = { enabled: new Set(FIDGET_KINDS), arms: true };
const idle: FidgetContext = { allowed: true, thinking: false, cards: true, chips: true };
const none = new Map<FidgetKind, number>();
const kinds = (c: FidgetCaps, ctx: FidgetContext, last?: FidgetKind, cooling = none) => candidates(c, ctx, last, cooling).map((x) => x.kind);

describe("candidates", () => {
  it("offers only the fidgets the page can play", () => {
    expect(kinds({ enabled: new Set(["look"]), arms: true }, idle)).toEqual(["look"]);
  });
  it("leaves the reaching fidgets out for an avatar whose arms cannot", () => {
    const k = kinds({ ...all, arms: false }, idle);
    expect(k).toEqual(expect.arrayContaining(["look", "peek", "lean"]));
    for (const reach of ["restack", "tap", "stretch", "scratch"] as const) expect(k).not.toContain(reach);
  });
  it("peeks only with cards in hand and restacks only with chips in front", () => {
    expect(kinds(all, { ...idle, cards: false })).not.toContain("peek");
    expect(kinds(all, { ...idle, chips: false })).not.toContain("restack");
  });
  it("leaves out the last one and any that is cooling down", () => {
    expect(kinds(all, idle, "look")).not.toContain("look");
    expect(kinds({ enabled: new Set(["look"]), arms: true }, idle, "look"), "unless it is the only one").toEqual(["look"]);
    expect(kinds(all, idle, undefined, new Map([["peek", 5]]))).not.toContain("peek");
  });
  it("makes peeking and tapping likelier while the seat thinks", () => {
    const weight = (ctx: FidgetContext, kind: FidgetKind) => candidates(all, ctx, undefined, none).find((c) => c.kind === kind)!.weight;
    expect(weight({ ...idle, thinking: true }, "peek")).toBeGreaterThan(weight(idle, "peek"));
    expect(weight({ ...idle, thinking: true }, "look")).toBe(weight(idle, "look"));
  });
});

describe("FidgetScheduler", () => {
  const starts = (fidgety: number, seconds: number, ctx: FidgetContext = idle, caps = all, seed = 7) => {
    const s = new FidgetScheduler(mulberry32(seed), caps, fidgety);
    const out: FidgetKind[] = [];
    for (let t = 0; t < seconds; t += 0.1) {
      const step = s.update(0.1, ctx);
      if (step.started) out.push(step.started.kind);
    }
    return out;
  };

  it("fidgets more for a restless character than a calm one (the traits change the rate)", () => {
    expect(starts(0.9, 600).length).toBeGreaterThan(starts(0.1, 600).length * 2);
    expect(gap(() => 0.5, 0.1, false)).toBeGreaterThan(gap(() => 0.5, 0.9, false));
  });
  it("fidgets more while thinking", () => {
    expect(starts(0.5, 600, { ...idle, thinking: true }).length).toBeGreaterThan(starts(0.5, 600).length * 1.5);
  });
  it("uses every kind it may, and never the same one twice running", () => {
    const out = starts(0.9, 3000);
    expect(new Set(out).size).toBe(FIDGET_KINDS.length);
    for (let i = 1; i < out.length; i++) expect(out[i]).not.toBe(out[i - 1]);
  });
  it("does nothing while it must not (speaking, or reacting), and stops what it was doing", () => {
    expect(starts(1, 300, { ...idle, allowed: false })).toEqual([]);
    const s = new FidgetScheduler(mulberry32(3), { enabled: new Set(["look", "lean"]), arms: true }, 1, 0.05);
    let active: FidgetKind | undefined;
    for (let t = 0; t < 60 && !active; t += 0.05) active = s.update(0.05, idle).active;
    expect(active).toBeDefined();
    expect(s.update(0.05, { ...idle, allowed: false })).toEqual({});
  });
  it("runs a fidget for its length and then waits", () => {
    const s = new FidgetScheduler(mulberry32(3), { enabled: new Set(["lean"]), arms: true }, 1, 0.05);
    let started = 0;
    let ran = 0;
    for (let t = 0; t < 200; t += 0.05) {
      const step = s.update(0.05, idle);
      if (step.started) started++;
      if (step.active) ran += 0.05;
    }
    expect(started).toBeGreaterThan(1);
    expect(ran / started).toBeGreaterThan(0.05); // each lasts (2 to 3 s at a twentieth)
    expect(ran).toBeLessThan(100); // and it is not on all the time
  });
  it("has nothing to start when nothing is enabled, and keeps waiting", () => {
    expect(starts(1, 300, idle, { enabled: new Set(), arms: true })).toEqual([]);
  });
});
