import { describe, expect, it, vi } from "vitest";
import { InstancedMesh } from "three";
import { BOARD_CARD, boardSlots, chipCounts, chipPile, HOLE_CARD, MAX_COLUMN, seatSlots, TableProps } from "./table-props.ts";
import { onFelt, ovalSeats } from "./table3d.ts";

describe("chipCounts", () => {
  it("makes an amount from the biggest chips down, richest first (black 100, blue 25, red 5, white 1)", () => {
    expect(chipCounts(98)).toEqual([0, 3, 4, 3]);
    expect(chipCounts(230)).toEqual([2, 1, 1, 0]);
    expect(chipCounts(0)).toEqual([0, 0, 0, 0]);
  });

  it("caps a column, so a huge stack is a tall tower and not a thousand meshes, and ignores nonsense", () => {
    expect(chipCounts(1_000_000)[0]).toBe(MAX_COLUMN);
    expect(chipCounts(-5)).toEqual([0, 0, 0, 0]);
    expect(chipCounts(7.9)).toEqual([0, 0, 1, 2]);
  });
});

describe("chipPile", () => {
  it("stands each colour in its own column, chips one on top of the next, centred on the spot", () => {
    const spots = chipPile(30, 1, 2, { x: 1, z: 0 }, 0.7); // 1 blue (25) and 1 red (5)
    expect(spots).toHaveLength(2);
    expect(spots[0]!.x + spots[1]!.x).toBeCloseTo(2, 8); // symmetric about x = 1
    expect(spots.every((s) => s.z === 2)).toBe(true);
    const tall = chipPile(3, 0, 0, { x: 1, z: 0 }, 0); // three white chips in one column
    expect(tall.map((s) => s.x)).toEqual([0, 0, 0]);
    expect(tall[1]!.y).toBeGreaterThan(tall[0]!.y);
  });
});

describe("seatSlots", () => {
  it("puts a seat's cards between it and the middle, and the bet closer to the middle than the stack", () => {
    const [, mid] = ovalSeats(3);
    const s = seatSlots(mid!);
    expect(Math.hypot(s.cards[0]!.x, s.cards[0]!.z)).toBeLessThan(Math.hypot(mid!.x, mid!.z));
    expect(Math.hypot(s.bet.x, s.bet.z)).toBeLessThan(Math.hypot(s.stack.x, s.stack.z));
    expect(s.cards[0]!.x).toBeLessThan(s.cards[1]!.x); // a pair side by side
  });

  it("keeps the dealer button and the stack on opposite sides of the cards", () => {
    const [, mid] = ovalSeats(3);
    const s = seatSlots(mid!);
    expect(Math.sign(s.button.x - s.cards[0]!.x)).not.toBe(Math.sign(s.stack.x - s.cards[0]!.x));
  });
});

describe("TableProps", () => {
  it("never frustum-culls the chip meshes: an instanced mesh takes its bounding sphere while empty and would vanish for good", () => {
    const props = new TableProps(0.7, ovalSeats(3), ["a", "b", "c"]);
    const chips = props.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    expect(chips).toHaveLength(4);
    expect(chips.every((c) => !c.frustumCulled)).toBe(true);
  });
});

describe("the layout of the table (VIK-84)", () => {
  it("lays the board out as five cards in a row that do not overlap each other, centred on the table", () => {
    const slots = boardSlots();
    expect(slots).toHaveLength(5);
    expect(slots[0]!.x + slots[4]!.x).toBeCloseTo(0, 8);
    expect(slots[1]!.x - slots[0]!.x).toBeGreaterThan(BOARD_CARD.w);
    expect(new Set(slots.map((s) => s.z)).size).toBe(1);
  });

  it("keeps every seat's two cards, bet and stack clear of the board and of each other, for tables of 2 to 6", () => {
    const need = Math.max(BOARD_CARD.w, HOLE_CARD.w) * 1.2;
    for (const n of [2, 3, 4, 5, 6]) {
      const seats = ovalSeats(n).map(seatSlots);
      const board = boardSlots();
      for (const [i, s] of seats.entries()) {
        for (const c of s.cards) for (const b of board) expect(Math.hypot(c.x - b.x, c.z - b.z), `${n} seats: seat ${i}'s card near the board`).toBeGreaterThan(need * 0.75);
        expect(Math.hypot(s.cards[0]!.x - s.cards[1]!.x, s.cards[0]!.z - s.cards[1]!.z)).toBeGreaterThan(HOLE_CARD.w * 1.2); // a pair side by side, not stacked
        for (const [j, o] of seats.entries()) {
          if (j <= i) continue;
          expect(Math.hypot(s.cards[0]!.x - o.cards[0]!.x, s.cards[0]!.z - o.cards[0]!.z), `${n} seats: seat ${i} and ${j}'s cards`).toBeGreaterThan(need);
        }
        for (const p of [...s.cards, s.stack, s.bet, s.button]) expect(onFelt(p.x, p.z), `${n} seats: seat ${i}'s thing at ${p.x.toFixed(2)},${p.z.toFixed(2)} is on the felt`).toBe(true);
      }
    }
  });

  it("draws a pot label with the amount, face-down hands until the showdown, and the hands face up at it", () => {
    // no browser here: a canvas that accepts every drawing call is enough, the test is about what is drawn, not how it looks
    const noop: unknown = new Proxy(() => noop, { get: (_, key) => (key === "measureText" ? () => ({ width: 10 }) : noop), set: () => true });
    vi.stubGlobal("Path2D", class {});
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
    const props = new TableProps(0.7, ovalSeats(3), ["a", "b", "c"]);
    const seats = [{ seat_id: "a", stack: 90, cards: ["As", "Kd"] }, { seat_id: "b", stack: 90, cards: ["2c", "7d"] }, { seat_id: "c", stack: 90, folded: true, cards: ["back", "back"] }];
    props.setState({ protocol_version: 1, type: "table_state", pot: 1234, street: "flop", board: ["Ks", "8d", "3c"], seats });
    expect(props.drawn.pot).toBe("Pot: 1,234");
    expect(props.drawn.handsFaceUp).toBe(false);
    props.setState({ protocol_version: 1, type: "table_state", pot: 0, street: "showdown", board: ["Ks", "8d", "3c", "2h", "9s"], seats });
    expect(props.drawn.handsFaceUp).toBe(true);
    expect(props.drawn.pot).toBeUndefined();
    expect(props.drawn.boardCards).toBe(3); // the turn and river are still turning over (VIK-114)
    props.update(10);
    expect(props.drawn.boardCards).toBe(5);
    vi.unstubAllGlobals();
  });
});

describe("the table moves (VIK-113)", () => {
  const noop: unknown = new Proxy(() => noop, { get: (_, key) => (key === "measureText" ? () => ({ width: 10 }) : noop), set: () => true });
  const make = () => {
    vi.stubGlobal("Path2D", class {});
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    return new TableProps(0.7, ovalSeats(3), ["a", "b", "c"]);
  };
  const row = (id: string, stack: number, extra: object = {}) => ({ seat_id: id, stack, cards: ["back", "back"], ...extra });
  const st = (o: object) => ({ protocol_version: 1, type: "table_state", hand_no: 1, ...o }) as Parameters<TableProps["setState"]>[0];

  it("throws chips in when a seat bets: the old piles stay until they land, then the new ones are drawn", () => {
    const props = make();
    props.setState(st({ pot: 6, street: "flop", seats: [row("a", 94), row("b", 94), row("c", 94)] }));
    const before = props.drawn.chips;
    props.setState(st({ pot: 18, street: "flop", seats: [row("a", 82, { bet: 12 }), row("b", 94), row("c", 94)] }));
    expect(props.motion.flights).toBeGreaterThan(0); // chips are in the air
    props.update(0.1);
    expect(props.motion.flights).toBeGreaterThan(0);
    expect(props.drawn.chips).toBe(before); // the piles are still as they were
    props.update(5); // long enough for any flight
    expect(props.motion.flights).toBe(0);
    const count = (n: number) => chipCounts(n).reduce((a, b) => a + b, 0);
    expect(props.drawn.chips).toBe(count(82) + count(12) + count(94) * 2 + count(6)); // the shorter stack, the bet in front, the others, the middle
    vi.unstubAllGlobals();
  });

  it("pushes a folded hand's cards away, then they are gone", () => {
    const props = make();
    props.setState(st({ street: "flop", seats: [row("a", 94), row("b", 94), row("c", 94)] }));
    props.setState(st({ street: "flop", seats: [row("a", 94, { folded: true }), row("b", 94), row("c", 94)] }));
    expect(props.motion.flights).toBeGreaterThan(0);
    props.update(5);
    expect(props.motion.flights).toBe(0);
    expect(props.drawn.seatCards).toEqual([0, 2, 2]);
    vi.unstubAllGlobals();
  });

  it("snaps to the new state when another arrives mid-flight, and moves nothing for a reader who asks for reduced motion", () => {
    const props = make();
    props.setState(st({ pot: 6, street: "flop", seats: [row("a", 94), row("b", 94), row("c", 94)] }));
    props.setState(st({ pot: 18, street: "flop", seats: [row("a", 82, { bet: 12 }), row("b", 94), row("c", 94)] }));
    props.setState(st({ pot: 18, street: "flop", seats: [row("a", 82, { bet: 12 }), row("b", 94), row("c", 94), ], event: { kind: "x", text: "x" } }));
    expect(props.motion.flights).toBe(0); // nothing changed in front of the players, and the old flight was finished
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const calm = new TableProps(0.7, ovalSeats(3), ["a", "b", "c"]);
    calm.setState(st({ pot: 6, street: "flop", seats: [row("a", 94), row("b", 94), row("c", 94)] }));
    calm.setState(st({ pot: 18, street: "flop", seats: [row("a", 82, { bet: 12 }), row("b", 94), row("c", 94)] }));
    expect(calm.motion.flights).toBe(0);
    vi.unstubAllGlobals();
  });
});
