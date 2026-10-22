// The activity log beside the table (VIK-138): what happened, in order, with a separator at each new hand ("Ada raises to 12", "Flop: A♠ K♦ 2♣",
// "Ben wins 36 with a pair of aces"). Pure: it reads the `event` of each `table_state` and the words are the game's, so the page knows no poker.
import type { MessageOf } from "@vikaki/protocol";
import { cardFace } from "./table.ts";

type State = MessageOf<"table_state">;

export type ActivityItem = { kind: "hand"; text: string; detail?: string } | { kind: "line"; text: string; seat?: string };

export const ACTIVITY_LINES = 400;

const same = (a: State["event"], b: State["event"]) => a?.kind === b?.kind && a?.seat_id === b?.seat_id && a?.text === b?.text && a?.amount === b?.amount;

/** The log after `next` arrived. The same beat sent again (a state that changes only a stack or an odds bar) adds nothing. */
export function addActivity(items: ActivityItem[], prev: State | undefined, next: State): ActivityItem[] {
  const ev = next.event;
  if (!ev || same(prev?.event, ev)) return items;
  const item: ActivityItem =
    ev.kind === "new_hand"
      ? { kind: "hand", text: ev.text, ...(ev.detail ? { detail: ev.detail } : {}) }
      : ev.kind === "street" && next.board?.length
        ? { kind: "line", text: `${ev.text}: ${next.board.map((c) => cardFace(c).text).join(" ")}` }
        : { kind: "line", text: ev.text, ...(ev.seat_id ? { seat: ev.seat_id } : {}) };
  return [...items, item].slice(-ACTIVITY_LINES);
}
