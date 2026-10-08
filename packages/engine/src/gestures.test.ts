import { describe, expect, it } from "vitest";
import { Gestures, MAX_GESTURE_ANGLE } from "./gestures.ts";

const run = (g: Gestures, seconds: number, step = 1 / 60) => {
  const samples: { pitch: number; roll: number }[] = [];
  for (let t = 0; t < seconds; t += step) samples.push(g.update(step));
  return samples;
};

describe("Gestures", () => {
  it("is still until a cue comes", () => {
    const g = new Gestures();
    for (const s of run(g, 1)) expect(s).toEqual({ pitch: 0, roll: 0 });
  });

  it("nods on emphasis: the head dips (positive pitch) and comes back to rest", () => {
    const g = new Gestures();
    g.cue("emphasis");
    const s = run(g, 1);
    expect(Math.max(...s.map((x) => x.pitch))).toBeGreaterThan(0.03);
    expect(Math.min(...s.map((x) => x.pitch))).toBeGreaterThanOrEqual(0);
    expect(s.at(-1)!.pitch).toBe(0);
  });

  it("lifts the head and tips it on a rising ending: chin up (negative pitch), a little tilt, then rest", () => {
    const g = new Gestures();
    g.cue("rise");
    const s = run(g, 1.5);
    expect(Math.min(...s.map((x) => x.pitch))).toBeLessThan(-0.03);
    expect(Math.max(...s.map((x) => Math.abs(x.roll)))).toBeGreaterThan(0.03);
    expect(s.at(-1)).toEqual({ pitch: 0, roll: 0 });
  });

  it("asks for a blink on a pause, once", () => {
    const g = new Gestures();
    expect(g.takeBlink()).toBe(false);
    g.cue("pause");
    expect(g.takeBlink()).toBe(true);
    expect(g.takeBlink()).toBe(false);
  });

  it("does the same in the same time whatever the frame rate", () => {
    const peak = (step: number) => Math.max(...run((() => { const g = new Gestures(); g.cue("emphasis"); return g; })(), 1, step).map((x) => x.pitch));
    expect(Math.abs(peak(1 / 15) - peak(1 / 120))).toBeLessThan(0.01);
  });

  it("never turns the head further than a friendly amount, however many cues pile up", () => {
    const g = new Gestures();
    for (let i = 0; i < 20; i++) g.cue(i % 2 ? "emphasis" : "rise");
    for (const s of run(g, 1)) {
      expect(Math.abs(s.pitch)).toBeLessThanOrEqual(MAX_GESTURE_ANGLE + 1e-9);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(MAX_GESTURE_ANGLE + 1e-9);
    }
  });

  it("is not skipped when the page stalls: a frame that takes a whole second still shows the start of the nod", () => {
    const g = new Gestures();
    g.cue("emphasis");
    expect(g.update(1).pitch).toBeGreaterThan(0.02); // not aged out in one jump
    const rest = Array.from({ length: 20 }, () => g.update(1).pitch);
    expect(Math.max(...rest)).toBeGreaterThan(0.04); // and the nod carries on, frame by frame, to its peak
    expect(rest.at(-1)).toBe(0); // then ends
  });

  it("a second nod while one is under way adds to it rather than being lost", () => {
    const single = new Gestures();
    single.cue("emphasis");
    const double = new Gestures();
    double.cue("emphasis");
    run(double, 0.1);
    double.cue("emphasis");
    run(single, 0.1);
    expect(Math.max(...run(double, 0.5).map((x) => x.pitch))).toBeGreaterThan(Math.max(...run(single, 0.5).map((x) => x.pitch)));
  });
});
