// A seated avatar's hands act the decision (VIK-137): knock on the table for a check, push chips forward for a call, bet or raise, toss the cards for a fold.
// Pure, like `Gestures` and `ReactionMotion`: it says how far to move each arm's seat-pose numbers (`forward`, `down`, `elbow`, in radians) at each moment, and
// `VrmAvatar` applies them on top of the seated pose. An avatar whose arms cannot do it nods instead (`Puppet.act`).

export type Act = "knock" | "push" | "toss";

/** What each decision looks like at the table: a check, two knocks; a call, bet or raise, a push forward; a fold, the cards tossed away. */
export function actFor(kind: string): Act | undefined {
  return kind === "check" ? "knock" : kind === "call" || kind === "bet" || kind === "raise" ? "push" : kind === "fold" ? "toss" : undefined;
}

/** How far one arm is from its seated pose, as changes to the seat-pose numbers. */
export interface ArmOffset {
  forward: number;
  down: number;
  elbow: number;
}
export interface ArmOffsets {
  left: ArmOffset;
  right: ArmOffset;
}

const REST: ArmOffset = { forward: 0, down: 0, elbow: 0 };
export const NO_OFFSETS: ArmOffsets = { left: REST, right: REST };

/** How long each act takes, in seconds. */
export const ACT_SECONDS: Record<Act, number> = { knock: 0.9, push: 0.9, toss: 0.6 };

const bump = (x: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)));
const scale = (o: ArmOffset, k: number): ArmOffset => ({ forward: o.forward * k + 0, down: o.down * k + 0, elbow: o.elbow * k + 0 }); // `+ 0` turns -0 into 0

/** The offsets of `act` at `phase` (0 to 1 through the act). The right hand knocks and tosses; both hands push. */
export function armOffsets(act: Act, phase: number): ArmOffsets {
  const p = Math.min(1, Math.max(0, phase));
  if (act === "knock") {
    // Two raps: the forearm lifts off the table and comes down, twice.
    const k = bump((p * 2) % 1) * (p < 1 ? 1 : 0);
    return { left: REST, right: scale({ forward: 0, down: -0.3, elbow: -0.5 }, k) };
  }
  if (act === "push") {
    // Reach forward with both hands, then ease back.
    const k = bump(p);
    const reach = { forward: 0.3, down: 0, elbow: -0.5 };
    return { left: scale(reach, k), right: scale(reach, k) };
  }
  // A quick flick: the hand rises and snaps forward, then returns.
  const k = bump(p);
  return { left: REST, right: scale({ forward: 0.35, down: -0.6, elbow: -0.6 }, k) };
}

/** The left hand's reach to the chips (VIK-105) added to `offsets`: forward and down to the stack beside it, the elbow in and working. */
export function withReach(offsets: ArmOffsets, amount: number, wiggle: number): ArmOffsets {
  if (amount <= 0) return offsets;
  const l = offsets.left;
  return { ...offsets, left: { forward: l.forward + 0.28 * amount, down: l.down + 0.1 * amount, elbow: l.elbow - 0.35 * amount + wiggle * amount } };
}

/** The act in progress. Frames longer than `MAX_STEP` advance it by that much only, as in `Gestures`. */
export class ArmActs {
  private reaching = 0;
  private wiggle = 0;
  private act: Act | undefined;
  private age = 0;
  private held: { act: Act; phase: number } | undefined;

  play(act: Act): void {
    this.act = act;
    this.age = 0;
  }

  /** Freeze the arms at `phase` of `act` (undefined lets go): for looking at a pose in a picture, since a screenshot cannot catch a motion of under a second. */
  hold(act: Act | undefined, phase = 0.25): void {
    this.held = act ? { act, phase } : undefined;
  }

  /**
   * Reach the left hand toward the stack of chips beside it, by `amount` from 0 to 1 (VIK-105), working at them by `wiggle` (radians of the elbow). It layers
   * on top of an act in progress, which is the right hand's and both hands'.
   */
  reach(amount: number, wiggle = 0): void {
    this.reaching = amount;
    this.wiggle = wiggle;
  }

  get playing(): Act | undefined {
    return this.act;
  }

  update(rawDt: number): ArmOffsets {
    return withReach(this.acted(rawDt), this.reaching, this.wiggle);
  }

  private acted(rawDt: number): ArmOffsets {
    if (this.held) return armOffsets(this.held.act, this.held.phase);
    if (!this.act) return NO_OFFSETS;
    this.age += Math.min(Math.max(0, rawDt), 0.05);
    const phase = this.age / ACT_SECONDS[this.act];
    if (phase >= 1) {
      this.act = undefined;
      return NO_OFFSETS;
    }
    return armOffsets(this.act, phase);
  }
}
