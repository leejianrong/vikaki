import { describe, expect, it } from "vitest";
import { addActivity, ACTIVITY_LINES, type ActivityItem } from "./activity.ts";

type S = Parameters<typeof addActivity>[2];
const st = (o: Partial<S>): S => ({ protocol_version: 1, type: "table_state", seats: [], ...o }) as S;

describe("addActivity", () => {
  it("separates hands, names the street with its board, and keeps each move and win in the game's words", () => {
    let items: ActivityItem[] = [];
    let prev: S | undefined;
    for (const s of [
      st({ event: { kind: "new_hand", text: "Hand 3", detail: "Blinds 1/2 · Ada deals" } }),
      st({ event: { kind: "raise", seat_id: "a", amount: 12, text: "Ada raises to 12" } }),
      st({ board: ["As", "Kd", "2c"], event: { kind: "street", text: "Flop" } }),
      st({ event: { kind: "win", seat_id: "b", text: "Ben wins 36 with a pair of aces" } }),
    ]) {
      items = addActivity(items, prev, s);
      prev = s;
    }
    expect(items).toEqual([
      { kind: "hand", text: "Hand 3", detail: "Blinds 1/2 · Ada deals" },
      { kind: "line", text: "Ada raises to 12", seat: "a" },
      { kind: "line", text: "Flop: A♠ K♦ 2♣" },
      { kind: "line", text: "Ben wins 36 with a pair of aces", seat: "b" },
    ]);
  });

  it("adds nothing for a state with no event or the same beat again, and keeps only the newest lines", () => {
    const ev = { kind: "check", seat_id: "a", text: "Ada checks" };
    const one = addActivity([], undefined, st({ event: ev }));
    expect(addActivity(one, st({ event: ev }), st({ event: ev, pot: 5 }))).toBe(one);
    expect(addActivity(one, st({ event: ev }), st({ pot: 5 }))).toBe(one);
    const many = Array.from({ length: ACTIVITY_LINES }, (): ActivityItem => ({ kind: "line", text: "x" }));
    expect(addActivity(many, undefined, st({ event: ev }))).toHaveLength(ACTIVITY_LINES);
  });
});
