import { Euler, Quaternion, Vector3, type Object3D } from "three";
import type { SeatPose } from "./renderer.ts";

type Side = "left" | "right";
type BoneName = `${Side}UpperArm` | `${Side}LowerArm` | `${Side}UpperLeg` | `${Side}LowerLeg` | `${Side}Hand` | "hips";
/** Looks a humanoid bone up by name, or returns null when the model has none (ADR-0019). */
export type BoneOf = (name: BoneName) => Object3D | null;

/** The spike's numbers (VIK-60): they rest Cookieman's hands on a table. A stick-armed model says `arms: "hang"` instead. */
export const DEFAULT_SEAT_POSE = { arms: { forward: 1.0, down: 1.0, elbow: 0.9 }, hipDrop: 0.45 } as const;

const worldY = (n: Object3D) => n.getWorldPosition(new Vector3()).y;

/**
 * Sit (ADR-0019): thighs forward, shins back, the hips lowered by `hipDrop` of their standing height, and the arms forward and in
 * (or left hanging). A bone the model lacks is skipped, so a model with no legs keeps standing ones (the table hides them).
 * Call once, on an avatar standing in its rest pose.
 */
export function applySeat(bone: BoneOf, pose: SeatPose = {}): void {
  const hipDrop = pose.hipDrop ?? DEFAULT_SEAT_POSE.hipDrop;
  const arms = pose.arms ?? DEFAULT_SEAT_POSE.arms;
  const hips = bone("hips");
  if (hips) {
    hips.parent?.updateWorldMatrix(true, false);
    hips.position.y -= hipDrop * worldY(hips);
  }
  for (const side of ["left", "right"] as const) {
    const s = side === "left" ? 1 : -1; // the left arm points along +x in the T-pose
    bone(`${side}UpperLeg`)?.quaternion.setFromEuler(new Euler(Math.PI / 2 - 0.1, 0, 0));
    bone(`${side}LowerLeg`)?.quaternion.setFromEuler(new Euler(-Math.PI / 2 + 0.1, 0, 0));
    if (arms === "hang") {
      bone(`${side}UpperArm`)?.quaternion.setFromEuler(new Euler(0, 0, s * 1.2));
      continue;
    }
    poseArm(bone, side, arms);
  }
}

/** One arm's seated pose from its numbers (`forward`, `down`, `elbow`); `VrmAvatar` calls it again with an act's offsets added (VIK-137). */
export function poseArm(bone: BoneOf, side: Side, arms: { forward: number; down: number; elbow: number }): void {
  const s = side === "left" ? 1 : -1;
  bone(`${side}UpperArm`)?.quaternion.copy(new Quaternion().setFromEuler(new Euler(0, -s * arms.forward, 0)).multiply(new Quaternion().setFromEuler(new Euler(0, 0, s * arms.down))));
  bone(`${side}LowerArm`)?.quaternion.setFromEuler(new Euler(0, -s * arms.elbow, 0));
}

/**
 * How far the knees are ahead of the hips, in metres along (`dirX`, `dirZ`) (a unit direction on the floor: toward the table's middle), the mean of both
 * legs; undefined without leg bones. A seat whose thighs run toward the table is positive; one whose legs run away from it (the VIK-81 bug) is negative.
 * Call after `applySeat` and a scene update.
 */
export function kneeReach(bone: BoneOf, dirX: number, dirZ: number): number | undefined {
  const hips = bone("hips");
  const knees = (["leftLowerLeg", "rightLowerLeg"] as const).map(bone).filter((n): n is Object3D => n != null);
  if (!hips || knees.length === 0) return undefined;
  const h = hips.getWorldPosition(new Vector3());
  const reach = knees.map((k) => {
    const p = k.getWorldPosition(new Vector3());
    return (p.x - h.x) * dirX + (p.z - h.z) * dirZ;
  });
  return reach.reduce((a, b) => a + b, 0) / reach.length;
}

/** World height of the hands (their mean), or undefined when the model has no hand bones. Call after `applySeat` and a scene update. */
export function handHeight(bone: BoneOf): number | undefined {
  const ys = (["leftHand", "rightHand"] as const).map(bone).filter((n): n is Object3D => n != null).map(worldY);
  return ys.length === 0 ? undefined : ys.reduce((a, b) => a + b, 0) / ys.length;
}
