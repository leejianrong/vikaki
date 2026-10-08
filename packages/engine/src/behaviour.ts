import type { HeadPose } from "./renderer.ts";

/** Small seedable RNG so behaviour is reproducible in tests (`?seed=1`). */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

export const BLINK_INTERVAL = { min: 3, max: 5 } as const; // seconds between blinks
const FIRST_BLINK = { min: 1, max: 3 } as const; // so a quiet avatar blinks soon after loading
// Close, hold fully shut, then open. The hold is longer than one frame at 30 fps, so the
// lids always reach 1 however the frames happen to fall.
const CLOSE_SECONDS = 0.06;
const HOLD_SECONDS = 0.04;
const OPEN_SECONDS = 0.12;
export const BLINK_SECONDS = CLOSE_SECONDS + HOLD_SECONDS + OPEN_SECONDS;

/** Eyelid closure over time: 0 open, 1 closed. Blinks every 3 to 5 seconds. */
export class Blinker {
  /** Number of blinks started so far. */
  blinks = 0;
  private untilNext: number;
  private sinceStart: number | null = null;
  private closedShown = false;

  constructor(private readonly rng: Rng) {
    this.untilNext = between(rng, FIRST_BLINK.min, FIRST_BLINK.max);
  }

  /** Start a blink now (the demo's "blink" button). No effect if one is already running. */
  trigger(): void {
    if (this.sinceStart === null) this.untilNext = 0;
  }

  update(dt: number): number {
    if (this.sinceStart === null) {
      this.untilNext -= dt;
      if (this.untilNext > 0) return 0;
      this.sinceStart = -this.untilNext; // carry the overshoot into the blink
      this.closedShown = false;
      this.blinks += 1;
    } else {
      this.sinceStart += dt;
    }
    const t = this.sinceStart;
    // However slow the frame rate, show fully shut at least once per blink. Without this, a
    // frame gap longer than the blink makes it vanish.
    if (!this.closedShown && t >= CLOSE_SECONDS) {
      this.closedShown = true;
      return 1;
    }
    if (t >= BLINK_SECONDS) {
      this.sinceStart = null;
      this.untilNext = between(this.rng, BLINK_INTERVAL.min, BLINK_INTERVAL.max);
      return 0;
    }
    if (t < CLOSE_SECONDS) return t / CLOSE_SECONDS;
    if (t < CLOSE_SECONDS + HOLD_SECONDS) return 1;
    return 1 - (t - CLOSE_SECONDS - HOLD_SECONDS) / OPEN_SECONDS;
  }
}


export const MAX_IDLE_ANGLE = 0.1; // radians, about 6 degrees

/** Slow, small, never-repeating-looking sway from a few sines of unrelated periods. */
export function idlePose(t: number): HeadPose {
  const tau = Math.PI * 2;
  return {
    yaw: 0.05 * Math.sin((tau * t) / 7.3),
    pitch: 0.025 * Math.sin((tau * t) / 5.1 + 1),
    roll: 0.03 * Math.sin((tau * t) / 9.7 + 2),
  };
}
