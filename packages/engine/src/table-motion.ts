// What moves between one `table_state` and the next (VIK-113): chips thrown in, bets swept into the pot, the pot slid to the winner, a folded hand
// pushed away. It is a pure comparison of two states, so it is tested without three.js; `TableProps` plays the plan. Like the rest of the table page
// it knows no poker, only chips in places: a seat's stack, its bet, the pot.
import type { MessageOf } from "@vikaki/protocol";

type State = MessageOf<"table_state">;

export type Place = { place: "stack"; seat: number } | { place: "bet"; seat: number } | { place: "pot" };

export interface Flight {
  from: Place;
  to: Place;
  amount: number;
  /** Starts only when the flights before it have landed (a payout waits for the sweep). */
  after?: boolean;
}

/** What to draw in place of the new numbers until the chips have landed: a seat's stack and bet as they were, and the pot's middle. */
export interface Hold {
  bet: Map<number, number>;
  stack: Map<number, number>;
  middle?: number;
  /** Board places and seats whose cards are not drawn still: they are in the air being dealt or flipped. */
  board: Set<number>;
  hole: Set<number>;
}

export interface Plan {
  flights: Flight[];
  /** Seats whose cards are pushed away. */
  mucks: number[];
  /** Seats being dealt their cards (a new hand, VIK-114). */
  deals: number[];
  /** Places on the board whose cards are turned over now (a street, VIK-114 and VIK-94). */
  boardFlips: number[];
  /** Seats whose hole cards are turned face up now (the showdown). */
  holeFlips: number[];
  hold: Hold;
}

/** The chips in the middle of the table: the pot less what is still in front of the players (the pot counts both). */
export function middlePot(state: State): number {
  return Math.max(0, (state.pot ?? 0) - state.seats.reduce((n, s) => n + (s.bet ?? 0), 0));
}

export function planMotion(prev: State | undefined, next: State, seatIds: string[]): Plan {
  const plan: Plan = { flights: [], mucks: [], deals: [], boardFlips: [], holeFlips: [], hold: { bet: new Map(), stack: new Map(), board: new Set(), hole: new Set() } };
  const before = (id: string) => prev?.seats.find((s) => s.seat_id === id);
  const freshHand = !prev || prev.hand_no !== next.hand_no;
  if (freshHand && next.event?.kind === "new_hand") {
    seatIds.forEach((id, i) => {
      const row = next.seats.find((s) => s.seat_id === id);
      if (row && !row.folded && row.cards?.length) plan.deals.push(i);
    });
    plan.hold.hole = new Set(plan.deals);
  }
  if (!prev || freshHand || (next.street === "preflop" && prev.street !== "preflop")) return plan;
  const had = prev.board?.length ?? 0;
  for (let k = had; k < (next.board?.length ?? 0); k++) plan.boardFlips.push(k);
  plan.hold.board = new Set(plan.boardFlips);
  seatIds.forEach((id, i) => {
    const a = before(id);
    const b = next.seats.find((s) => s.seat_id === id);
    const down = (c?: string[]) => !!c?.length && c.every((x) => x === "back");
    if (a && b && !b.folded && down(a.cards) && b.cards?.length && !down(b.cards)) plan.holeFlips.push(i);
  });
  for (const i of plan.holeFlips) plan.hold.hole.add(i);
  const sweeps: Flight[] = [];
  seatIds.forEach((id, i) => {
    const a = before(id);
    const b = next.seats.find((s) => s.seat_id === id);
    if (!a || !b) return;
    const was = a.bet ?? 0;
    const is = b.bet ?? 0;
    if (b.folded && !a.folded) plan.mucks.push(i);
    if (is > was && b.stack < a.stack) {
      plan.flights.push({ from: { place: "stack", seat: i }, to: { place: "bet", seat: i }, amount: is - was });
      plan.hold.stack.set(i, a.stack);
      plan.hold.bet.set(i, was);
    } else if (was > 0 && is === 0) {
      sweeps.push({ from: { place: "bet", seat: i }, to: { place: "pot" }, amount: was });
      plan.hold.bet.set(i, was);
    }
  });
  plan.flights.push(...sweeps);
  if (sweeps.length) plan.hold.middle = middlePot(prev);
  if (next.winners?.length && !prev.winners?.length) {
    plan.hold.middle ??= middlePot(prev) + sweeps.reduce((n, f) => n + f.amount, 0);
    for (const w of next.winners) {
      const i = seatIds.indexOf(w.seat_id);
      if (i < 0) continue;
      plan.flights.push({ from: { place: "pot" }, to: { place: "stack", seat: i }, amount: w.amount, after: true });
      plan.hold.stack.set(i, before(w.seat_id)?.stack ?? 0);
    }
  }
  return plan;
}
