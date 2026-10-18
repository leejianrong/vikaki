import { describe, expect, it } from "vitest";
import { middlePot, planMotion } from "./table-motion.ts";

type S = Parameters<typeof planMotion>[1];
const state = (o: Partial<S> & { seats: S["seats"] }): S => ({ protocol_version: 1, type: "table_state", ...o }) as S;
const IDS = ["a", "b", "c"];

const flop = state({ hand_no: 1, street: "flop", pot: 6, board: ["As", "Kd", "2c"], seats: [{ seat_id: "a", stack: 94 }, { seat_id: "b", stack: 94 }, { seat_id: "c", stack: 94 }] });

describe("middlePot", () => {
  it("is the pot less what is still in front of the players, so no chip is drawn twice", () => {
    expect(middlePot(state({ pot: 30, seats: [{ seat_id: "a", stack: 1, bet: 10 }, { seat_id: "b", stack: 1, bet: 10 }] }))).toBe(10);
    expect(middlePot(state({ seats: [{ seat_id: "a", stack: 1 }] }))).toBe(0);
    expect(middlePot(state({ pot: 5, seats: [{ seat_id: "a", stack: 1, bet: 9 }] }))).toBe(0);
  });
});

describe("planMotion", () => {
  it("throws chips from the stack to the bet spot when a seat bets, holding the old piles until they land", () => {
    const next = state({ hand_no: 1, street: "flop", pot: 18, board: flop.board, seats: [{ seat_id: "a", stack: 82, bet: 12 }, { seat_id: "b", stack: 94 }, { seat_id: "c", stack: 94 }] });
    const plan = planMotion(flop, next, IDS);
    expect(plan.flights).toEqual([{ from: { place: "stack", seat: 0 }, to: { place: "bet", seat: 0 }, amount: 12 }]);
    expect(plan.hold.stack.get(0)).toBe(94);
    expect(plan.hold.bet.get(0)).toBe(0);
  });

  it("only throws what a raise added over the bet already in front", () => {
    const before = state({ hand_no: 1, street: "flop", pot: 18, seats: [{ seat_id: "a", stack: 82, bet: 12 }, { seat_id: "b", stack: 94 }] });
    const after = state({ hand_no: 1, street: "flop", pot: 42, seats: [{ seat_id: "a", stack: 82, bet: 12 }, { seat_id: "b", stack: 70, bet: 24 }] });
    expect(planMotion(before, after, ["a", "b"]).flights).toEqual([{ from: { place: "stack", seat: 1 }, to: { place: "bet", seat: 1 }, amount: 24 }]);
    const reraise = state({ hand_no: 1, street: "flop", pot: 66, seats: [{ seat_id: "a", stack: 58, bet: 36 }, { seat_id: "b", stack: 70, bet: 24 }] });
    expect(planMotion(after, reraise, ["a", "b"]).flights).toEqual([{ from: { place: "stack", seat: 0 }, to: { place: "bet", seat: 0 }, amount: 24 }]);
  });

  it("sweeps every bet into the pot when the bets are gone, holding the old bets and pot until the chips land", () => {
    const before = state({ hand_no: 1, street: "preflop", pot: 12, seats: [{ seat_id: "a", stack: 94, bet: 6 }, { seat_id: "b", stack: 94, bet: 6 }, { seat_id: "c", stack: 94 }] });
    const plan = planMotion(before, flop, IDS);
    expect(plan.flights).toEqual([
      { from: { place: "bet", seat: 0 }, to: { place: "pot" }, amount: 6 },
      { from: { place: "bet", seat: 1 }, to: { place: "pot" }, amount: 6 },
    ]);
    expect([...plan.hold.bet]).toEqual([[0, 6], [1, 6]]);
    expect(plan.hold.middle).toBe(0);
  });

  it("slides the pot to the winners when the winners are named, after sweeping any bets still out", () => {
    const before = state({ hand_no: 1, street: "showdown", pot: 40, seats: [{ seat_id: "a", stack: 60, bet: 20 }, { seat_id: "b", stack: 60, bet: 20 }] });
    const after = state({ hand_no: 1, street: "showdown", pot: 0, winners: [{ seat_id: "b", amount: 40 }], seats: [{ seat_id: "a", stack: 60 }, { seat_id: "b", stack: 100 }] });
    const plan = planMotion(before, after, ["a", "b"]);
    expect(plan.flights.map((f) => [f.from.place, f.to.place, f.amount])).toEqual([["bet", "pot", 20], ["bet", "pot", 20], ["pot", "stack", 40]]);
    expect(plan.flights[2]!.to).toEqual({ place: "stack", seat: 1 });
    expect(plan.flights[2]!.after).toBe(true); // the payout waits for the sweep
    expect(plan.hold.stack.get(1)).toBe(60);
  });

  it("pushes the cards of a seat that folds away", () => {
    const before = state({ hand_no: 1, street: "flop", seats: [{ seat_id: "a", stack: 94, cards: ["back", "back"] }, { seat_id: "b", stack: 94, cards: ["back", "back"] }] });
    const after = state({ hand_no: 1, street: "flop", seats: [{ seat_id: "a", stack: 94, folded: true, cards: ["back", "back"] }, { seat_id: "b", stack: 94, cards: ["back", "back"] }] });
    expect(planMotion(before, after, ["a", "b"]).mucks).toEqual([0]);
    expect(planMotion(after, after, ["a", "b"]).mucks).toEqual([]);
  });

  it("does nothing for the first state, a new hand, or a state that changes nothing in front of the players", () => {
    expect(planMotion(undefined, flop, IDS)).toEqual({ flights: [], mucks: [], hold: { bet: new Map(), stack: new Map() } });
    const newHand = state({ hand_no: 2, street: "preflop", pot: 3, seats: [{ seat_id: "a", stack: 100 }, { seat_id: "b", stack: 99, bet: 1 }, { seat_id: "c", stack: 98, bet: 2 }] });
    expect(planMotion(flop, newHand, IDS).flights).toEqual([]);
    expect(planMotion(flop, { ...flop, event: { kind: "street", text: "Flop" } } as S, IDS).flights).toEqual([]);
  });
});
