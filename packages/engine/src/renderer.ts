/** The five mouth shapes every avatar type must support (VRM names; doodle avatars draw one sprite each). */
export const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type Viseme = (typeof VISEMES)[number];
export type VisemeWeights = Partial<Record<Viseme, number>>;

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * What lip sync and behaviour code may ask of an avatar. VRM is the first implementation;
 * sprite/doodle avatars can follow without touching lip sync or behaviour (ADR-0005).
 */
export interface AvatarRenderer {
  /** Mouth shape weights in [0, 1]. Unlisted visemes are set to 0. */
  setVisemes(weights: VisemeWeights): void;
  /** Eyelid closure in [0, 1]. */
  setBlink(amount: number): void;
  /** Head rotation in radians, relative to the rest pose. */
  setHeadPose(pose: HeadPose): void;
  /** Advance internal animation by `dt` seconds. */
  update(dt: number): void;
  /**
   * What the avatar is actually showing for each mouth shape after the last `update`, in [0, 1]. It can differ
   * from what was set when blends or overrides intervene. Optional: a renderer that cannot tell leaves it out.
   */
  appliedVisemes?(): VisemeWeights;
}
