// Looking round the room (VIK-102): now and then an idle seat glances at something in the den, a window or a picture, and looks back. The choice
// and the timing are pure (a seeded random source and the time passed), so they are tested without a renderer. The page turns the head by the
// angles it returns; the eyes stay as the model draws them, since none of the cartoon avatars here moves its eyes apart from its head.
import type { Rng } from "./behaviour.ts";
import type { LookTarget } from "./den.ts";
import type { SeatSpot } from "./table3d.ts";

export interface Glance {
  target: string;
  /** Head turn from the way the seat faces, radians, positive toward world +x when facing +z (as `seatLookYaw`). */
  yaw: number;
  /** Head pitch, radians, positive down (a nod), so looking up at a clock is negative. */
  pitch: number;
}

/** The furthest from straight ahead a seat will look, radians: a head cannot turn to what is behind it. */
const REACH = 1.4;
const MAX_YAW = 0.7;
const MAX_PITCH = 0.3;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The head angles for a seat at `spot`, its head at `head`, to look at `target`, or undefined when the target is too far round to the side or behind. */
export function glanceAt(spot: SeatSpot, head: { x: number; y: number; z: number }, target: LookTarget): Glance | undefined {
  const dx = target.position.x - head.x;
  const dz = target.position.z - head.z;
  const along = Math.hypot(dx, dz);
  if (along < 0.3) return undefined;
  const delta = wrap(Math.atan2(dx, dz) - spot.facing);
  if (Math.abs(delta) > REACH) return undefined;
  const pitch = -Math.atan2(target.position.y - head.y, along);
  return {
    target: target.name,
    yaw: Math.sign(delta) * Math.min(MAX_YAW, Math.abs(delta) * 0.7),
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch * 0.6)),
  };
}

/** Pick a glance from the ones that are in reach, not repeating the last two, the nearer to straight ahead the likelier. */
export function chooseGlance(options: Glance[], recent: readonly string[], rng: Rng): Glance | undefined {
  const fresh = options.filter((o) => !recent.includes(o.target));
  const pool = fresh.length > 0 ? fresh : options.filter((o) => o.target !== recent[recent.length - 1]);
  if (pool.length === 0) return undefined;
  const weights = pool.map((o) => 1.5 - Math.min(1, Math.abs(o.yaw) / MAX_YAW));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export interface LookContext {
  /** False while the seat is speaking, or looking at whoever is: a glance would fight with it. */
  allowed: boolean;
  /** The seat is thinking its move: it looks about more. */
  thinking: boolean;
}

/** One seat's looking round: waits, glances at a thing for a moment, looks back. `pace` scales every wait and hold (below 1 is quicker). */
export class LookAround {
  private wait: number;
  private hold = 0;
  private current: Glance | undefined;
  private readonly options: Glance[];
  private readonly recent: string[] = [];
  private wasThinking = false;
  private frozen: Glance | undefined;

  constructor(
    private readonly rng: Rng,
    targets: LookTarget[],
    spot: SeatSpot,
    head: { x: number; y: number; z: number },
    private readonly pace = 1,
  ) {
    this.options = targets.map((t) => glanceAt(spot, head, t)).filter((g): g is Glance => g !== undefined);
    this.wait = this.gap(false);
  }

  private gap(thinking: boolean): number {
    return (thinking ? 2.5 + this.rng() * 3 : 6 + this.rng() * 8) * this.pace;
  }

  /** Hold a glance at the named thing, or let go with undefined, to look at the pose in a picture. Returns whether that thing is in reach. */
  freeze(name: string | undefined): boolean {
    this.frozen = name === undefined ? undefined : this.options.find((o) => o.target === name);
    return name === undefined || this.frozen !== undefined;
  }

  /** The glance to hold now, or undefined to look ahead. */
  update(dt: number, ctx: LookContext): Glance | undefined {
    if (this.frozen) return this.frozen;
    if (!ctx.allowed) {
      this.current = undefined;
      this.wait = Math.max(this.wait, 1.5 * this.pace); // not the moment a line ends
      return undefined;
    }
    if (ctx.thinking && !this.wasThinking) this.wait = Math.min(this.wait, this.gap(true)); // starting to think: look about sooner
    this.wasThinking = ctx.thinking;
    if (this.current) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.current = undefined;
        this.wait = this.gap(ctx.thinking);
      }
      return this.current;
    }
    this.wait -= dt;
    if (this.wait <= 0) {
      const next = chooseGlance(this.options, this.recent, this.rng);
      if (next) {
        this.current = next;
        this.hold = (0.9 + this.rng() * 1.1) * this.pace;
        this.recent.push(next.target);
        if (this.recent.length > 2) this.recent.shift();
      } else this.wait = this.gap(ctx.thinking);
    }
    return this.current;
  }
}
