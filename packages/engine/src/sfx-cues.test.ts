import { describe, expect, it } from "vitest";
import { cuesFor, type SoundName } from "./sfx-cues.ts";

type S = Parameters<typeof cuesFor>[1];
const state = (o: Partial<S> & { seats: S["seats"] }): S => ({ protocol_version: 1, type: "table_state", ...o }) as S;
const IDS = ["a", "b"];
const names = (prev: S | undefined, next: S) => cuesFor(prev, next, IDS).map((c) => c.sound);
const base = state({ hand_no: 1, street: "flop", pot: 6, board: ["As", "Kd", "2c"], seats: [{ seat_id: "a", stack: 94 }, { seat_id: "b", stack: 94 }] });

describe("cuesFor", () => {
  it("is silent for the first state and for one that changes nothing", () => {
    expect(names(undefined, base)).toEqual([]);
    expect(names(base, base)).toEqual([]);
  });

  it("clinks chips for a bet, sweeps them to the pot, and pours them to the winner", () => {
    const bet = state({ ...base, pot: 18, seats: [{ seat_id: "a", stack: 82, bet: 12 }, { seat_id: "b", stack: 94 }] } as S);
    expect(names(base, bet)).toEqual(["chips"]);
    const turn = state({ ...base, street: "turn", board: [...base.board!, "9h"], pot: 18, seats: [{ seat_id: "a", stack: 82 }, { seat_id: "b", stack: 82 }] } as S);
    const swept = names(bet, turn);
    expect(swept).toContain("sweep");
    expect(swept).toContain("flip"); // the new board card turns over
    const won = state({ ...turn, street: "complete", pot: 0, winners: [{ seat_id: "a", amount: 36 }], seats: [{ seat_id: "a", stack: 118 }, { seat_id: "b", stack: 82 }] } as S);
    expect(names(turn, won)).toEqual(expect.arrayContaining(["cascade", "win"]));
  });

  it("chimes and deals two cards a seat for a new hand, and ticks when the turn moves", () => {
    const next = state({ hand_no: 2, street: "preflop", event: { kind: "new_hand", text: "Hand 2" }, turn: "a", board: [], seats: [{ seat_id: "a", stack: 90, cards: ["back", "back"] }, { seat_id: "b", stack: 90, cards: ["back", "back"] }] });
    const got = names(base, next);
    expect(got.filter((n) => n === "deal")).toHaveLength(4);
    expect(got).toEqual(expect.arrayContaining(["chime", "tick"] satisfies SoundName[]));
    expect(names(next, { ...next, turn: "a" } as S)).toEqual([]); // the same turn again is no new tick
  });

  it("rolls a drum for an all in, pushes a fold away, and sounds a bust-out at the win", () => {
    const shove = state({ ...base, pot: 100, seats: [{ seat_id: "a", stack: 0, bet: 94 }, { seat_id: "b", stack: 94 }] } as S);
    expect(names(base, shove)).toContain("allin");
    const folded = state({ ...base, seats: [{ seat_id: "a", stack: 94, folded: true }, { seat_id: "b", stack: 94 }] } as S);
    expect(names(base, folded)).toContain("fold");
    const won = state({ ...shove, street: "complete", pot: 0, winners: [{ seat_id: "b", amount: 188 }], seats: [{ seat_id: "a", stack: 0 }, { seat_id: "b", stack: 188 }] } as S);
    expect(names(shove, won)).toContain("bust");
  });
});
