import type { Object3D } from "three";

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

/** Where things are on an avatar, in world units, for placing the camera and the manga symbols. */
export interface AvatarFraming {
  /** Centre of the head. */
  head: { x: number; y: number; z: number };
  /** Height of the top of the avatar, hat or hair included. */
  top: number;
  /** Height of the eyes (measured or estimated). */
  eyeLevel: number;
  /** False when `eyeLevel` is an estimate, not read from the model. */
  eyeBones: boolean;
  /** How much room the body needs beside another avatar: about shoulder to shoulder, not the span of outstretched arms. */
  width: number;
}

/**
 * An avatar the page can put on its stage: it has something to add to the three.js scene and can say where its head is.
 * Everything that is not VRM-specific about showing an avatar goes through this, so a 2D sprite renderer (a textured plane
 * that swaps mouth images) can stand in for `VrmAvatar` without touching the page, camera or symbols.
 */
export interface SceneAvatar extends AvatarRenderer {
  /** What to add to the scene. */
  readonly scene: Object3D;
  framing(): AvatarFraming;
}
