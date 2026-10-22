// Cameras for the poker table (VIK-95): named shots (the wide three-quarter view, a view straight down, a close-up of each player) and a rig that moves
// between them with an eased glide, so a cut is never a jump, even when a new shot is asked for halfway through a move. Pure: three.js is used only for
// its maths in the tests, and the page applies each frame's `Shot` to its camera. No crane moves: every shot is a still frame, and only the glide between
// them moves.
import { TABLE_A, TABLE_B, type SeatSpot } from "./table3d.ts";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Shot {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** A shot is named: `wide`, `overhead`, `board` (the community cards, close), or `seat:<index>` for a close-up of that player. */
export type ShotName = "wide" | "overhead" | "board" | `seat:${number}`;

export interface ShotContext {
  /** Height of the table top. */
  tableY: number;
  spots: SeatSpot[];
  /** Where each player's head is (world), and the height of the top of each avatar (a hat counts), for the close-ups. */
  heads: Vec3[];
  tops: number[];
  aspect: number;
  /** The field of view the table view uses, in degrees. */
  fov: number;
}

export function parseShot(value: string | null | undefined, seats: number): ShotName | undefined {
  if (value === "wide" || value === "overhead" || value === "board") return value;
  const m = /^seat:(\d+)$/.exec(value ?? "");
  if (m && Number(m[1]) < seats) return value as ShotName;
  return undefined;
}

const tanHalf = (fovDegrees: number) => Math.tan((fovDegrees * Math.PI) / 360);

export function shotFor(name: ShotName, c: ShotContext): Shot {
  const reach = Math.max(...c.spots.map((s) => Math.abs(s.x)), TABLE_A) + 0.38;
  if (name === "overhead") {
    // Straight down at the middle of the table, far enough up for the whole length of it, with a hair of tilt so "up" is defined.
    const height = Math.max(2.2, reach / (tanHalf(c.fov) * Math.max(c.aspect, 0.1)), (TABLE_B + 0.7) / tanHalf(c.fov));
    return { position: { x: 0, y: c.tableY + height, z: 0.05 }, target: { x: 0, y: c.tableY, z: 0 }, fov: c.fov };
  }
  if (name === "board") {
    // Low over the near rail, close on the middle of the felt: the five board cards, the pot and the chips fill the picture.
    return { position: { x: 0, y: c.tableY + 0.75, z: 1.35 }, target: { x: 0, y: c.tableY, z: -0.05 }, fov: c.fov };
  }
  if (name === "wide") {
    // A three-quarter view over the near rail: faces stay readable, the cards and chips show, and the seats at the two ends fit.
    const back = Math.max(3.0, reach / (tanHalf(c.fov) * Math.max(c.aspect, 0.1)));
    return { position: { x: 0, y: c.tableY + 1.3, z: back }, target: { x: 0, y: c.tableY + 0.18, z: -0.3 }, fov: c.fov };
  }
  const i = Number(name.slice("seat:".length));
  const head = c.heads[i]!;
  const facing = c.spots[i]!.facing;
  // In front of the player along the way they face (so we see their face), far enough back for the head, its hat and some shoulders: about four head
  // heights from the chest to the top of the frame, whatever the avatar's size.
  const h = Math.max(0.08, c.tops[i]! - head.y);
  const visible = 4.2 * h;
  const dist = Math.max(0.7, visible / (2 * tanHalf(c.fov)));
  const aim = head.y + 0.3 * h;
  return {
    position: { x: head.x + Math.sin(facing) * dist, y: aim + 0.04, z: head.z + Math.cos(facing) * dist },
    target: { x: head.x, y: aim, z: head.z },
    fov: c.fov,
  };
}

/** Slow in, slow out. */
export const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const mix = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });

/** The frame longest a step may move the glide by, in seconds, so a stalled page glides on from where it was rather than leaping. */
const MAX_STEP = 0.05;

/**
 * Glides from the shot it is at to the one it is told to go to. Asking for a new shot in the middle of a glide starts the next one from where the camera
 * is that moment, so the path is always continuous.
 */
export class CameraRig {
  private from: Shot;
  private to: Shot;
  private age = 0;
  private duration = 0;
  private shown: Shot;

  constructor(start: Shot) {
    this.from = this.to = this.shown = start;
  }

  get moving(): boolean {
    return this.age < this.duration;
  }

  /** Where the camera is now. */
  get shot(): Shot {
    return this.shown;
  }

  /** Go to `shot` over `seconds` (0 is an immediate set, for a resize or the first frame). */
  moveTo(shot: Shot, seconds = 1.1): void {
    this.from = this.shown;
    this.to = shot;
    this.age = 0;
    this.duration = seconds;
    if (seconds <= 0) this.shown = shot;
  }

  /** Change where the glide is going without restarting it (the window was resized: the same shot, a new aspect). */
  retarget(shot: Shot): void {
    this.to = shot;
    if (!this.moving) this.shown = shot;
  }

  update(rawDt: number): Shot {
    if (!this.moving) return this.shown;
    this.age = Math.min(this.duration, this.age + Math.min(Math.max(0, rawDt), MAX_STEP));
    if (this.age >= this.duration) return (this.shown = this.to); // arrived: exactly on the shot, not within rounding of it
    const k = ease(this.age / this.duration);
    this.shown = { position: mix(this.from.position, this.to.position, k), target: mix(this.from.target, this.to.target, k), fov: lerp(this.from.fov, this.to.fov, k) };
    return this.shown;
  }
}
