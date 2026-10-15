import type { Gesture } from "@vikaki/protocol";

/** The longest slice of animation time one frame may advance, in seconds (as in `Gestures`). */
const MAX_STEP = 0.05;

/** Time constant of the head turning toward whoever is speaking, in seconds. Slower than a feeling: a glance, not a flick. */
const LOOK_TAU = 0.3;

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

  play(gesture: Gesture): void {
    this.motions.push(...PARTS[gesture].map((m) => ({ ...m })));
  }

  /** Turn the head toward `yaw` (radians, positive toward the avatar's left on screen's right) and hold it; 0 looks straight ahead. */
  look(yaw: number): void {
    this.target = yaw;
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
    return { pitch: pitch + 0, yaw: yaw + this.gaze + 0, roll: roll + 0 };
  }
}
