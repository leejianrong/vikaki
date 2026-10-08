import { describe, expect, it } from "vitest";
import { idlePose } from "./behaviour.ts";
import { poseFor } from "./emotion.ts";
import type { AvatarRenderer, HeadPose, VisemeWeights } from "./renderer.ts";
import { Puppet } from "./stage.ts";

class FakeAvatar implements AvatarRenderer {
  visemes: VisemeWeights = {};
  blink = 0;
  head: HeadPose = { yaw: 0, pitch: 0, roll: 0 };
  setVisemes(w: VisemeWeights) {
    this.visemes = w;
  }
  setBlink(a: number) {
    this.blink = a;
  }
  setHeadPose(p: HeadPose) {
    this.head = p;
  }
  update() {}
}

/** Run a puppet for `seconds` at 60 fps. */
function run(p: Puppet, seconds: number, mouth: VisemeWeights = {}) {
  for (let t = 0; t < seconds; t += 1 / 60) p.update(1 / 60, mouth);
}

describe("Puppet with an emotion", () => {
  it("holds the mouth's rest shape while silent, and lets lip sync win while it speaks", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1);
    p.emotion.set("happy", 1);
    run(p, 1.5);
    expect(a.visemes.ee).toBeGreaterThan(0.4); // a smile at rest
    run(p, 0.2, { aa: 1 });
    expect(a.visemes.aa).toBe(1);
    expect(a.visemes.ee ?? 0).toBeLessThan(0.01); // no smile stacked on a wide-open "aa"
  });

  it("does not change what lip sync asked for, as far as the page's own record goes", () => {
    const p = new Puppet(new FakeAvatar(), 1);
    p.emotion.set("surprised", 1);
    const asked = { ih: 0.2 };
    run(p, 1, asked);
    expect(p.visemes).toEqual(asked);
  });

  it("keeps the lids part-closed for a squint, whatever the blinker is doing", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1);
    p.emotion.set("smug", 1);
    run(p, 1.5);
    const squint = poseFor("smug", 1).squint;
    let min = 1;
    for (let t = 0; t < 8; t += 1 / 60) {
      p.update(1 / 60, {});
      min = Math.min(min, a.blink);
    }
    expect(min).toBeGreaterThanOrEqual(squint - 0.02);
  });

  it("still blinks fully over a squint", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1);
    p.emotion.set("happy", 1);
    let max = 0;
    for (let t = 0; t < 8; t += 1 / 60) {
      p.update(1 / 60, {});
      max = Math.max(max, a.blink);
    }
    expect(max).toBe(1);
  });

  it("adds the emotion's head tilt to the idle sway", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1);
    p.emotion.set("sad", 1);
    run(p, 3);
    const idle = idlePose(3 + 0); // the sway is small; the sad droop is bigger
    expect(a.head.pitch).toBeGreaterThan(idle.pitch + 0.08);
  });

  it("with no emotion set, behaves as before: no rest mouth, blinker alone", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1);
    run(p, 1);
    expect(a.visemes).toEqual({});
    expect(p.emotion.pose.symbol).toBeNull();
  });
});

describe("Puppet with voice gestures", () => {
  it("nods the head on an emphasis cue, on top of the idle sway", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1);
    run(p, 2);
    const before = a.head.pitch;
    p.gestures.cue("emphasis");
    let peak = before;
    for (let t = 0; t < 0.4; t += 1 / 60) {
      p.update(1 / 60, {});
      peak = Math.max(peak, a.head.pitch);
    }
    expect(peak - before).toBeGreaterThan(0.03);
    expect(p.head).toEqual(a.head);
  });

  it("blinks soon after a pause cue", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1);
    run(p, 0.2); // the first blink is due in 1 to 3 seconds
    const blinks = p.blinks;
    p.gestures.cue("pause");
    run(p, 0.3);
    expect(p.blinks).toBe(blinks + 1);
  });
});

describe("Puppet with sway off", () => {
  it("holds the head perfectly still at rest, so pictures taken at different moments match", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1, false);
    const poses: HeadPose[] = [];
    for (let t = 0; t < 3; t += 1 / 60) {
      p.update(1 / 60, {});
      poses.push({ ...a.head });
    }
    expect(new Set(poses.map((h) => `${h.pitch},${h.yaw},${h.roll}`)).size).toBe(1);
    expect(poses[0]).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  });

  it("still lets an emotion move the head", () => {
    const a = new FakeAvatar();
    const p = new Puppet(a, 1, false);
    p.emotion.set("sad", 1);
    run(p, 1.5);
    expect(a.head.pitch).toBeGreaterThan(0.1);
  });
});
