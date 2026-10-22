// Which sound effects a change of `table_state` calls for (VIK-122), and when after it. Pure, like `planMotion` (it reads the same plan, so a sound
// and the motion it goes with cannot drift apart), and tested without any audio. `Sfx` makes the sounds.
import type { MessageOf } from "@vikaki/protocol";
import { planMotion } from "./table-motion.ts";

type State = MessageOf<"table_state">;

export const SOUND_NAMES = ["chips", "sweep", "cascade", "deal", "flip", "fold", "chime", "win", "allin", "tick", "bust", "knock", "push"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export interface Cue {
  sound: SoundName;
  /** Seconds after the state arrived. */
  at: number;
}

// How long the motion takes (see `TableProps`): a chip flight, a dealt card's gap, the middle of a flip.
const LAND_S = 0.6;
const DEAL_GAP_S = 0.12;
const FLIP_MID_S = 0.28;

export function cuesFor(prev: State | undefined, next: State, seatIds: string[]): Cue[] {
  const plan = planMotion(prev, next, seatIds);
  const cues: Cue[] = [];
  const ev = next.event;
  const fresh = ev !== undefined && (prev?.event?.kind !== ev.kind || prev.event.seat_id !== ev.seat_id || prev.event.text !== ev.text);
  // The decision itself (VIK-136): a check is two knocks on the table, a call or a bet or a raise a push of chips forward; a fold is the card slide below.
  if (fresh && ev.kind === "check") cues.push({ sound: "knock", at: 0 }, { sound: "knock", at: 0.22 });
  else if (fresh && (ev.kind === "call" || ev.kind === "bet" || ev.kind === "raise")) cues.push({ sound: "push", at: 0 });
  if (next.event?.kind === "new_hand" && plan.deals.length) cues.push({ sound: "chime", at: 0 });
  plan.deals.forEach((_, n) => [0, 1].forEach((k) => cues.push({ sound: "deal", at: (k * plan.deals.length + n) * DEAL_GAP_S + 0.3 })));
  for (const f of plan.flights) {
    if (f.from.place === "stack" && f.to.place === "bet") cues.push({ sound: "chips", at: LAND_S });
    else if (f.to.place === "pot") cues.push({ sound: "sweep", at: LAND_S - 0.1 });
    else if (f.from.place === "pot") cues.push({ sound: "cascade", at: LAND_S + 0.3 });
  }
  for (const _ of plan.mucks) cues.push({ sound: "fold", at: 0.1 });
  plan.boardFlips.forEach((_, j) => cues.push({ sound: "flip", at: j * 0.2 + FLIP_MID_S }));
  plan.holeFlips.forEach((_, j) => cues.push({ sound: "flip", at: j * 0.15 + FLIP_MID_S }));
  if (prev && next.seats.some((s) => s.stack === 0 && (s.bet ?? 0) > 0 && (prev.seats.find((p) => p.seat_id === s.seat_id)?.stack ?? 0) > 0)) cues.push({ sound: "allin", at: 0 });
  if (next.turn !== undefined && next.turn !== prev?.turn) cues.push({ sound: "tick", at: 0 });
  if (next.winners?.length && !prev?.winners?.length) {
    cues.push({ sound: "win", at: 0 });
    const won = new Set(next.winners.map((w) => w.seat_id));
    if (next.seats.some((s) => s.stack === 0 && !won.has(s.seat_id))) cues.push({ sound: "bust", at: 1.4 });
  }
  return cues;
}
