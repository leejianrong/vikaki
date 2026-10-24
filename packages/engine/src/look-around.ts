// Looking round the room (VIK-102): an idle seat glances at something in the den, a window or a picture, and looks back. The choice is pure (a seeded
// random source), so it is tested without a renderer; the timing is the scheduler's (VIK-103). The page turns the head by the
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

/** One seat's choice of what to glance at. When to glance is the fidget scheduler's (`fidgets.ts`); this knows only the targets in reach. */
export class Glancer {
  private readonly options: Glance[];
  private readonly recent: string[] = [];
  private frozen: Glance | undefined;

  constructor(
    private readonly rng: Rng,
    targets: LookTarget[],
    spot: SeatSpot,
    head: { x: number; y: number; z: number },
  ) {
    this.options = targets.map((t) => glanceAt(spot, head, t)).filter((g): g is Glance => g !== undefined);
  }

  /** Whether any target is in reach: a seat that can look at nothing has no look fidget. */
  get any(): boolean {
    return this.options.length > 0;
  }

  /** Choose something to look at, never one of the last two while others are in reach. */
  begin(): Glance | undefined {
    if (this.frozen) return this.frozen;
    const next = chooseGlance(this.options, this.recent, this.rng);
    if (next) {
      this.recent.push(next.target);
      if (this.recent.length > 2) this.recent.shift();
    }
    return next;
  }

  /** Hold a glance at the named thing, or let go with undefined, to look at the pose in a picture. Returns whether that thing is in reach. */
  freeze(name: string | undefined): boolean {
    this.frozen = name === undefined ? undefined : this.options.find((o) => o.target === name);
    return name === undefined || this.frozen !== undefined;
  }

  /** The frozen glance, if one is held: it overrides the scheduler. */
  get held(): Glance | undefined {
    return this.frozen;
  }
}
