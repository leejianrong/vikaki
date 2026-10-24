// The fidget scheduler (VIK-103): what an idle seat does with its body while it waits, and when. Pure (a seeded random source and the time passed), so the
// choices are tested without a renderer. It picks; the page plays. One fidget runs at a time, a seat that speaks or is spoken to lets go of it at once
// (a fidget is below speaking and below a reaction), and how often it starts one comes from the seat's `fidgety` from 0 (sits still) to 1 (restless),
// which the game works out from the character's traits.
import type { Rng } from "./behaviour.ts";

export type FidgetKind = "look" | "peek" | "restack" | "tap" | "lean" | "stretch" | "scratch";

/** What each costs and means. `reach` needs arms that bend; `cards` needs a hand in play; `chips` needs a stack. */
const KINDS: Record<FidgetKind, { weight: number; seconds: [number, number]; cooldown: number; reach?: boolean; cards?: boolean; chips?: boolean; thinkingBoost?: number }> = {
  look: { weight: 5, seconds: [0.9, 2], cooldown: 4 },
  peek: { weight: 3, seconds: [2, 2.6], cooldown: 25, cards: true, thinkingBoost: 2 },
  restack: { weight: 2, seconds: [2.6, 3.4], cooldown: 30, reach: true, chips: true },
  tap: { weight: 1, seconds: [1.4, 2], cooldown: 20, reach: true, thinkingBoost: 2.5 },
  lean: { weight: 1, seconds: [2, 3], cooldown: 25 },
  stretch: { weight: 0.7, seconds: [2.2, 2.8], cooldown: 45, reach: true },
  scratch: { weight: 1, seconds: [1.2, 1.8], cooldown: 30, reach: true },
};
export const FIDGET_KINDS = Object.keys(KINDS) as FidgetKind[];

export interface Fidget {
  kind: FidgetKind;
  seconds: number;
}

export interface FidgetCaps {
  /** The fidgets the page can play now: each one is switched on as its card lands, and a seat with nothing to look at leaves `look` out. */
  enabled: ReadonlySet<FidgetKind>;
  /** The avatar's arms reach and bend (it can act a decision, ADR-0031): else the reaching fidgets are left out, not faked with a nod. */
  arms: boolean;
}

export interface FidgetContext {
  /** False while the seat speaks, looks at whoever does, or acts or reacts: a fidget would fight it. */
  allowed: boolean;
  thinking: boolean;
  /** The seat holds cards it has not folded, and has chips in front of it. */
  cards: boolean;
  chips: boolean;
}

export interface FidgetStep {
  /** The fidget that began this step. */
  started?: Fidget;
  /** What is running now. */
  active?: FidgetKind;
}

/** How long to wait between fidgets, seconds, for a seat that fidgets this much: 14 to 32 for a still one, about 5 to 11 for a restless one. */
export function gap(rng: Rng, fidgety: number, thinking: boolean): number {
  return ((7 + rng() * 9) / (0.5 + fidgety)) / (thinking ? 2.2 : 1);
}

/** The kinds that may start now, with their weights. */
export function candidates(caps: FidgetCaps, ctx: FidgetContext, last: FidgetKind | undefined, cooling: ReadonlyMap<FidgetKind, number>): { kind: FidgetKind; weight: number }[] {
  const out: { kind: FidgetKind; weight: number }[] = [];
  for (const kind of FIDGET_KINDS) {
    const k = KINDS[kind];
    if (!caps.enabled.has(kind) || (cooling.get(kind) ?? 0) > 0) continue;
    if ((k.reach && !caps.arms) || (k.cards && !ctx.cards) || (k.chips && !ctx.chips)) continue;
    out.push({ kind, weight: k.weight * (ctx.thinking ? (k.thinkingBoost ?? 1) : 1) });
  }
  const others = out.filter((c) => c.kind !== last); // not the same one twice running, unless it is the only one that may
  return others.length > 0 ? others : out;
}

export class FidgetScheduler {
  private wait: number;
  private current: { kind: FidgetKind; left: number } | undefined;
  private last: FidgetKind | undefined;
  private readonly cooling = new Map<FidgetKind, number>();
  private wasThinking = false;

  constructor(
    private readonly rng: Rng,
    private readonly caps: FidgetCaps,
    /** How restless the seat is, 0 to 1; the page updates it as the game's state arrives. */
    public fidgety = 0.5,
    /** Scales every wait and length (below 1 is quicker): a test shortens them. */
    private readonly pace = 1,
  ) {
    this.wait = gap(rng, fidgety, false) * pace;
  }

  private pick(ctx: FidgetContext): Fidget | undefined {
    const pool = candidates(this.caps, ctx, this.last, this.cooling);
    if (pool.length === 0) return undefined;
    let r = this.rng() * pool.reduce((a, c) => a + c.weight, 0);
    let chosen = pool[pool.length - 1]!.kind;
    for (const c of pool) {
      r -= c.weight;
      if (r <= 0) {
        chosen = c.kind;
        break;
      }
    }
    const k = KINDS[chosen];
    return { kind: chosen, seconds: (k.seconds[0] + this.rng() * (k.seconds[1] - k.seconds[0])) * this.pace };
  }

  update(dt: number, ctx: FidgetContext): FidgetStep {
    for (const [kind, left] of this.cooling) {
      if (left - dt <= 0) this.cooling.delete(kind);
      else this.cooling.set(kind, left - dt);
    }
    if (!ctx.allowed) {
      this.current = undefined;
      this.wait = Math.max(this.wait, 1.5 * this.pace); // not the moment a line ends
      return {};
    }
    if (ctx.thinking && !this.wasThinking) this.wait = Math.min(this.wait, gap(this.rng, this.fidgety, true) * this.pace); // starting to think: fidget sooner
    this.wasThinking = ctx.thinking;
    if (this.current) {
      this.current.left -= dt;
      if (this.current.left <= 0) {
        this.current = undefined;
        this.wait = gap(this.rng, this.fidgety, ctx.thinking) * this.pace;
        return {};
      }
      return { active: this.current.kind };
    }
    this.wait -= dt;
    if (this.wait > 0) return {};
    const next = this.pick(ctx);
    if (!next) {
      this.wait = gap(this.rng, this.fidgety, ctx.thinking) * this.pace;
      return {};
    }
    this.current = { kind: next.kind, left: next.seconds };
    this.last = next.kind;
    this.cooling.set(next.kind, KINDS[next.kind].cooldown * this.pace);
    return { started: next, active: next.kind };
  }
}
