import { Group, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import type { AvatarFraming, HeadPose, SceneAvatar, VisemeWeights } from "./renderer.ts";
import { frameAvatar, Puppet } from "./stage.ts";

/** A stand-in for any non-VRM avatar (a 2D sprite, say): only what the seam asks for, nothing from three-vrm. */
class FakeSceneAvatar implements SceneAvatar {
  readonly scene = new Group();
  visemes: VisemeWeights = {};
  blink = 0;
  constructor(private readonly f: AvatarFraming) {}
  framing() {
    return this.f;
  }
  setVisemes(w: VisemeWeights) {
    this.visemes = w;
  }
  setBlink(a: number) {
    this.blink = a;
  }
  setHeadPose(_p: HeadPose) {}
  update() {}
}

describe("a SceneAvatar that is not a VRM", () => {
  const framing: AvatarFraming = { head: { x: 0.2, y: 1.3, z: -0.1 }, top: 1.7, eyeLevel: 1.5, eyeBones: false, width: 0.6 };

  it("is framed by the camera from what it reports, at its eye line and in front of its head", () => {
    const camera = new PerspectiveCamera(28, 1, 0.1, 50);
    const result = frameAvatar(camera, new FakeSceneAvatar(framing));
    expect(result.eyeBones).toBe(false);
    expect(camera.position.y).toBe(1.5);
    expect(camera.position.x).toBe(0.2);
    expect(camera.position.z).toBeGreaterThan(-0.1);
  });

  it("is driven by the puppet (mouth and blink reach it)", () => {
    const a = new FakeSceneAvatar(framing);
    const p = new Puppet(a, 1, false);
    p.update(1 / 60, { aa: 0.7 });
    expect(a.visemes.aa).toBe(0.7);
  });
});
