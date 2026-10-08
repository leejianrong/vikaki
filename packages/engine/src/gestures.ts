import type { ProsodyCue } from "@vikaki/audio";

/** The longest slice of animation time one frame may advance, in seconds. */
const MAX_STEP = 0.05;

/** However many cues pile up, the head never turns further than this (radians, about 7 degrees). */
export const MAX_GESTURE_ANGLE = 0.12;

interface Motion {
  /** Seconds since the cue. */
  age: number;
  duration: number;
  pitch: number;
  roll: number;
}

/** A smooth there-and-back: 0 at the start and end, 1 in the middle. */
const bump = (x: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)));

/**
 * What a listener's head does in answer to the way a voice goes: a nod on a stressed word, a lift and a tilt when it
 * rises like a question, a blink at a pause. The face has no brows, so the head does the raising (ADR-0015).
 */
export class Gestures {
  private motions: Motion[] = [];
  private blinkWanted = false;

  cue(cue: ProsodyCue): void {
    if (cue === "emphasis") this.motions.push({ age: 0, duration: 0.35, pitch: 0.06, roll: 0 });
    else if (cue === "rise") this.motions.push({ age: 0, duration: 0.8, pitch: -0.05, roll: 0.06 });
    else this.blinkWanted = true;
  }

  /** True once after a pause cue: time to blink. */
  takeBlink(): boolean {
    const wanted = this.blinkWanted;
    this.blinkWanted = false;
    return wanted;
  }

  /**
   * Head offsets for this frame, in radians, to add to the idle sway and the emotion. A frame longer than `MAX_STEP` (the page
   * stalled, as software WebGL does at the first speech) moves the animation on by `MAX_STEP` only, so a nod is delayed, not skipped.
   */
  update(rawDt: number): { pitch: number; roll: number } {
    const dt = Math.min(rawDt, MAX_STEP);
    let pitch = 0;
    let roll = 0;
    for (const m of this.motions) {
      m.age += dt;
      const k = bump(m.age / m.duration);
      pitch += m.pitch * k;
      roll += m.roll * k;
    }
    this.motions = this.motions.filter((m) => m.age < m.duration);
    const clamp = (x: number) => Math.max(-MAX_GESTURE_ANGLE, Math.min(MAX_GESTURE_ANGLE, x));
    return { pitch: clamp(pitch) + 0, roll: clamp(roll) + 0 }; // `+ 0` turns -0 into 0
  }
}
