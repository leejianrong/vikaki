// The idle extras (VIK-106): tap the fingers, lean back, stretch, scratch. Pure, like `arm-act.ts`: a pose for each at each moment of the fidget, as changes
// to the arms' seat-pose numbers, how far the body leans back, and a small turn of the head. The page plays it; `VrmAvatar` applies the arms and the lean.
// Tap, stretch and scratch need arms that bend (the scheduler does not pick them for an avatar whose arms cannot); a lean needs only a body.
import { NO_OFFSETS, type ArmOffset, type ArmOffsets } from "./arm-act.ts";
import type { FidgetKind } from "./fidgets.ts";

export type ExtraKind = Extract<FidgetKind, "tap" | "lean" | "stretch" | "scratch">;
export const EXTRA_KINDS: readonly ExtraKind[] = ["tap", "lean", "stretch", "scratch"];
export const isExtra = (k: FidgetKind | undefined): k is ExtraKind => k !== undefined && (EXTRA_KINDS as readonly string[]).includes(k);

/** How far the body leans back at the most, in radians over the spine and chest together. */
export const LEAN_BACK = 0.3;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** In over the first fifth, held, out over the last fifth. */
export function envelope(phase: number): number {
  return smooth(phase / 0.2) * (1 - smooth((phase - 0.8) / 0.2));
}

const REST: ArmOffset = { forward: 0, down: 0, elbow: 0 };
const arm = (forward: number, down: number, elbow: number, k: number): ArmOffset => ({ forward: forward * k + 0, down: down * k + 0, elbow: elbow * k + 0 });

export interface ExtraPose {
  arms: ArmOffsets;
  /** 0 upright to 1 leaning back by `LEAN_BACK`. */
  lean: number;
  /** A turn of the head on top of everything else, radians (a nod is a positive pitch). */
  head: { yaw: number; pitch: number };
}

export function extraPose(kind: ExtraKind, phase: number): ExtraPose {
  const p = Math.min(1, Math.max(0, phase));
  const k = envelope(p);
  if (kind === "tap") {
    // The right hand's forearm lifts a little off the table and comes down, four times quickly: fingers drumming.
    const drum = Math.abs(Math.sin(Math.PI * 4 * p)) * k;
    return { arms: { left: REST, right: arm(0, -0.08, -0.18, drum) }, lean: 0, head: { yaw: 0, pitch: 0.04 * k } };
  }
  if (kind === "lean") return { arms: NO_OFFSETS, lean: k, head: { yaw: 0, pitch: -0.06 * k } };
  if (kind === "stretch") {
    // Both arms up and out, the body back, the head tipped back.
    const a = arm(-0.3, -2.4, -0.2, k);
    return { arms: { left: a, right: a }, lean: 0.8 * k, head: { yaw: 0, pitch: -0.18 * k } };
  }
  // A scratch: the right hand up to the head and working there, the head tipped into it.
  const work = 0.15 * Math.sin(Math.PI * 10 * p) * k;
  return { arms: { left: REST, right: { ...arm(-0.2, -2.1, 1.0, k), elbow: 1.0 * k + work } }, lean: 0, head: { yaw: -0.08 * k, pitch: 0.05 * k } };
}
