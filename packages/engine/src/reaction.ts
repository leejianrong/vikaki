import type { Gesture } from "@vikaki/protocol";

/** The longest slice of animation time one frame may advance, in seconds (as in `Gestures`). */
const MAX_STEP = 0.05;

/** Time constant of the head turning toward whoever is speaking, in seconds. Slower than a feeling: a glance, not a flick. */
const LOOK_TAU = 0.3;

/** Time constant of a glance round the room (VIK-102): quicker than the turn toward a speaker, since it is a flick of the head. */
const GLANCE_TAU = 0.2;

interface Motion {
  /** Seconds since the gesture began; negative until a delayed part starts. */
  age: number;
  duration: number;
  pitch: number;
  yaw: number;
  roll: number;
}

const bump = (x: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)));

/** The motions each gesture is made of (radians, about 5 to 6 degrees at most). A part with a delay starts when its `age` reaches 0. */
const PARTS: Record<Gesture, Motion[]> = {
  nod: [
    { age: 0, duration: 0.4, pitch: 0.1, yaw: 0, roll: 0 },
    { age: -0.4, duration: 0.4, pitch: 0.1, yaw: 0, roll: 0 },
  ],
  shake: [
    { age: 0, duration: 0.3, pitch: 0, yaw: 0.1, roll: 0 },
    { age: -0.3, duration: 0.3, pitch: 0, yaw: -0.1, roll: 0 },
    { age: -0.6, duration: 0.3, pitch: 0, yaw: 0.1, roll: 0 },
  ],
  tilt: [{ age: 0, duration: 1.2, pitch: 0, yaw: 0, roll: 0.14 }],
};

/**
 * A silent seat's head: the gestures of a `react` (a nod, a shake, a tilt) and the turn toward whoever is speaking. Both are offsets, in
 * radians, added to the idle sway and the emotion. Frames longer than `MAX_STEP` advance the animation by that much only.
 */
export class ReactionMotion {
  private motions: Motion[] = [];
  private gaze = 0;
  private target = 0;
  private glanceYaw = { now: 0, to: 0 };
  private glancePitch = { now: 0, to: 0 };

  /** A nod, shake or tilt is under way. */
  get active(): boolean {
    return this.motions.length > 0;
  }

  play(gesture: Gesture): void {
    this.motions.push(...PARTS[gesture].map((m) => ({ ...m })));
  }

  /** Turn the head toward `yaw` (radians, positive toward the avatar's left on screen's right) and hold it; 0 looks straight ahead. */
  look(yaw: number): void {
    this.target = yaw;
  }

  /** Glance at something in the room (VIK-102): turn the head by `yaw` and `pitch` on top of everything else, or with nothing look back. Held until changed. */
  glance(to?: { yaw: number; pitch: number }): void {
    this.glanceYaw.to = to?.yaw ?? 0;
    this.glancePitch.to = to?.pitch ?? 0;
  }

  /** Where the head is turned now, eased toward the last `look`. */
  get looking(): number {
    return this.gaze;
  }

  update(rawDt: number): { pitch: number; yaw: number; roll: number } {
    const dt = Math.min(Math.max(0, rawDt), MAX_STEP);
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    for (const m of this.motions) {
      m.age += dt;
      const k = bump(m.age / m.duration);
      pitch += m.pitch * k;
      yaw += m.yaw * k;
      roll += m.roll * k;
    }
    this.motions = this.motions.filter((m) => m.age < m.duration);
    this.gaze += (this.target - this.gaze) * (1 - Math.exp(-dt / LOOK_TAU));
    if (Math.abs(this.target - this.gaze) < 1e-4) this.gaze = this.target;
    for (const g of [this.glanceYaw, this.glancePitch]) {
      g.now += (g.to - g.now) * (1 - Math.exp(-dt / GLANCE_TAU));
      if (Math.abs(g.to - g.now) < 1e-4) g.now = g.to;
    }
    return { pitch: pitch + this.glancePitch.now, yaw: yaw + this.gaze + this.glanceYaw.now, roll };
  }
}
