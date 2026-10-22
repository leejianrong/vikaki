// The auto-director (VIK-96): decides which camera shot to cut to as a hand plays: the speaker while a line is said, a big move, the board on each street,
// the table at the showdown, the winner at the end. Pure, with the time given to it, so a scripted hand can be tested to a list of cuts. It only names shots;
// the page makes the move. A cut obeys minimum shot lengths (a shot is held so the picture never flickers) and priorities (a more important moment may cut
// sooner), and a manual choice pauses it for a while.
import type { ShotName } from "./cameras.ts";

export type Cue =
  | { kind: "speak"; seat: number }
  | { kind: "line_end"; seat: number }
  | { kind: "action"; seat: number; big: boolean }
  | { kind: "street" }
  | { kind: "showdown" }
  | { kind: "win"; seat: number }
  | { kind: "new_hand" };

export interface DirectorTimes {
  /** A more important moment may cut away after this many seconds on a shot. */
  minCut: number;
  /** After the last line ends, a speaker's close-up stays this long, then the camera goes back to the wide shot. */
  settle: number;
  /** A cut that had to wait is dropped if it has not been possible within this many seconds. */
  stale: number;
  /** How long a manual choice keeps the director quiet. */
  override: number;
}

export const TIMES: DirectorTimes = { minCut: 1.2, settle: 1.5, stale: 3, override: 20 };

interface Want {
  shot: ShotName;
  /** 0 the idle wide shot, 4 the winner. */
  priority: number;
  /** How long to stay on it before anything of the same or lower priority may cut away. */
  hold: number;
  at: number;
}

export class Director {
  enabled = true;
  private current: { shot: ShotName; priority: number; hold: number; since: number } = { shot: "wide", priority: 0, hold: 0, since: -Infinity };
  private pending: Want | undefined;
  private quietUntil = -Infinity;
  /** Who is speaking now, and when their line ended (a close-up goes back to wide `settle` seconds after). */
  private speaking = new Set<number>();
  private lastSpoke = -Infinity;

  constructor(private readonly times: DirectorTimes = TIMES) {}

  /** The shot the director is on. */
  get shot(): ShotName {
    return this.current.shot;
  }

  /** A person chose a shot: the director keeps out of the way for a while, and counts it as the current shot. */
  override(shot: ShotName, now: number): void {
    this.current = { shot, priority: 0, hold: 0, since: now };
    this.pending = undefined;
    this.quietUntil = now + this.times.override;
  }

  /** Something happened at the table. Returns the shot to cut to now, if any. */
  cue(c: Cue, now: number): ShotName | undefined {
    if (c.kind === "speak") (this.speaking.add(c.seat), (this.lastSpoke = now));
    if (c.kind === "line_end") (this.speaking.delete(c.seat), (this.lastSpoke = now));
    if (!this.enabled || now < this.quietUntil) return undefined;
    const want = this.wantFor(c, now);
    if (!want) return undefined;
    // a pending want of higher priority is not displaced by a lesser one
    if (!this.pending || want.priority >= this.pending.priority) this.pending = want;
    return this.tick(now);
  }

  /** Time passed: make a cut that was waiting, or go back to the wide shot when nothing is going on. */
  tick(now: number): ShotName | undefined {
    if (!this.enabled || now < this.quietUntil) return undefined;
    if (this.pending && now - this.pending.at > this.times.stale) this.pending = undefined;
    if (!this.pending && this.current.priority > 0 && this.speaking.size === 0 && now - this.lastSpoke >= this.times.settle && now - this.current.since >= this.current.hold) {
      this.pending = { shot: "wide", priority: 0, hold: 0, at: now };
    }
    const w = this.pending;
    if (!w) return undefined;
    if (w.shot === this.current.shot) {
      this.pending = undefined;
      return undefined;
    }
    const sinceCut = now - this.current.since;
    const allowed = w.priority > this.current.priority ? sinceCut >= this.times.minCut : sinceCut >= this.current.hold;
    if (!allowed) return undefined;
    this.pending = undefined;
    this.current = { shot: w.shot, priority: w.priority, hold: w.hold, since: now };
    return w.shot;
  }

  private wantFor(c: Cue, now: number): Want | undefined {
    switch (c.kind) {
      case "speak":
        return { shot: `seat:${c.seat}`, priority: 2, hold: 2.5, at: now };
      case "action":
        return c.big ? { shot: `seat:${c.seat}`, priority: 2, hold: 2.5, at: now } : undefined;
      case "street":
        return { shot: "board", priority: 3, hold: 3, at: now };
      case "showdown":
        return { shot: "wide", priority: 3, hold: 3.5, at: now };
      case "win":
        return { shot: `seat:${c.seat}`, priority: 4, hold: 4, at: now };
      case "new_hand":
        return { shot: "wide", priority: 3, hold: 1, at: now };
      case "line_end":
        return undefined;
    }
  }
}
