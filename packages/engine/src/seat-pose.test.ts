import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { applySeat, handHeight, type BoneOf } from "./seat-pose.ts";

/** A bare skeleton: hips at 1 m, legs hanging from them, arms out from the shoulders (the left along -x, as in a VRM's normalized bones, where +z lowers it), a hand at the end of each arm. */
function skeleton(without: string[] = []) {
  const root = new Object3D();
  const bones: Record<string, Object3D> = {};
  const add = (name: string, parent: Object3D, x: number, y: number) => {
    const n = new Object3D();
    n.position.set(x, y, 0);
    parent.add(n);
    bones[name] = n;
    return n;
  };
  const hips = add("hips", root, 0, 1);
  for (const [side, s] of [["left", 1], ["right", -1]] as const) {
    const leg = add(`${side}UpperLeg`, hips, 0.1 * s, 0);
    add(`${side}LowerLeg`, leg, 0, -0.45);
    const arm = add(`${side}UpperArm`, hips, -0.2 * s, 0.5);
    const fore = add(`${side}LowerArm`, arm, -0.3 * s, 0);
    add(`${side}Hand`, fore, -0.25 * s, 0);
  }
  root.updateMatrixWorld(true);
  const bone: BoneOf = (name) => (without.includes(name) ? null : (bones[name] ?? null));
  return { root, bone, bones };
}

describe("applySeat (ADR-0019)", () => {
  it("lowers the hips by the asked fraction of their standing height, and bends the legs", () => {
    const { root, bone, bones } = skeleton();
    applySeat(bone, { hipDrop: 0.4 });
    root.updateMatrixWorld(true);
    expect(bones.hips!.getWorldPosition(new Vector3()).y).toBeCloseTo(0.6, 5);
    const knee = bones.leftLowerLeg!.getWorldPosition(new Vector3());
    expect(knee.z).toBeGreaterThan(0.3); // the thigh points forward
  });

  it("brings the hands forward and down from the T-pose, or leaves the arms at the sides for 'hang'", () => {
    const sat = skeleton();
    applySeat(sat.bone);
    sat.root.updateMatrixWorld(true);
    const hand = sat.bones.leftHand!.getWorldPosition(new Vector3());
    expect(Math.abs(hand.z)).toBeGreaterThan(0.2); // moved off the T-pose line along x
    const hung = skeleton();
    applySeat(hung.bone, { arms: "hang" });
    hung.root.updateMatrixWorld(true);
    expect(hung.bones.leftLowerArm!.quaternion.w).toBe(1); // the forearm is left alone
    expect(hung.bones.leftHand!.getWorldPosition(new Vector3()).y).toBeLessThan(hung.bones.leftUpperArm!.getWorldPosition(new Vector3()).y - 0.3); // the arm points down
  });

  it("skips bones the model lacks instead of throwing, and says so through handHeight", () => {
    const { root, bone } = skeleton(["leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg", "leftHand", "rightHand"]);
    expect(() => applySeat(bone)).not.toThrow();
    root.updateMatrixWorld(true);
    expect(handHeight(bone)).toBeUndefined();
  });

  it("reports the mean height of the hands", () => {
    const { root, bone, bones } = skeleton();
    bones.leftHand!.position.y += 0.1;
    root.updateMatrixWorld(true);
    const l = bones.leftHand!.getWorldPosition(new Vector3()).y;
    const r = bones.rightHand!.getWorldPosition(new Vector3()).y;
    expect(handHeight(bone)).toBeCloseTo((l + r) / 2, 8);
  });
});
