import { Mesh, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { PEEK_TILT, peekPhase, peekPlacement } from "./peek.ts";
import { HOLE_CARD, TableProps } from "./table-props.ts";
import { ovalSeats } from "./table3d.ts";

describe("peekPhase", () => {
  it("starts and ends flat and still, with the cards up through the middle and the head dipping first and lifting last", () => {
    expect(peekPhase(0)).toEqual({ cards: 0, head: 0 });
    expect(peekPhase(1)).toEqual({ cards: 0, head: 0 });
    expect(peekPhase(0.5)).toEqual({ cards: 1, head: 1 });
    expect(peekPhase(0.15).head).toBeGreaterThan(peekPhase(0.15).cards);
    expect(peekPhase(0.85).head).toBeGreaterThan(peekPhase(0.85).cards);
  });
});

describe("peekPlacement", () => {
  it("lifts the middle of the card and brings it toward the player as the near edge comes up", () => {
    const p = peekPlacement(1, 0.14);
    expect(p.alpha).toBeCloseTo(PEEK_TILT, 8);
    expect(p.up).toBeGreaterThan(0.04);
    expect(p.along).toBeLessThan(0);
    expect(peekPlacement(0, 0.14)).toEqual({ alpha: 0, up: 0, along: 0 });
  });
});

describe("TableProps.setPeek (VIK-104)", () => {
  const noop: unknown = new Proxy(() => noop, { get: (_, key) => (key === "measureText" ? () => ({ width: 10 }) : noop), set: () => true });
  const make = () => {
    vi.stubGlobal("Path2D", class {});
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
    vi.stubGlobal("matchMedia", () => ({ matches: true })); // reduced motion: the cards are drawn at once
    return new TableProps(0.7, ovalSeats(3), ["a", "b", "c"]);
  };
  const state = (street = "flop") => ({ protocol_version: 1, type: "table_state", hand_no: 1, street, seats: ["a", "b", "c"].map((id) => ({ seat_id: id, stack: 90, cards: ["back", "back"] })) }) as Parameters<TableProps["setState"]>[0];
  const holeCards = (props: TableProps, seat: number) => props.group.children.flatMap((g) => g.children).filter((m): m is Mesh => (m.userData.hole as { seat: number } | undefined)?.seat === seat);

  it("lifts a seat's two cards, tilted with the near edge up, and no other seat's", () => {
    const props = make();
    props.setState(state());
    const flat = holeCards(props, 1).map((m) => m.position.y);
    const others = holeCards(props, 0).map((m) => m.position.y);
    props.setPeek(1, 1);
    const cards = holeCards(props, 1);
    expect(cards).toHaveLength(2);
    cards.forEach((m, k) => expect(m.position.y, "raised").toBeGreaterThan(flat[k]! + 0.04));
    expect(holeCards(props, 0).map((m) => m.position.y), "the others stay").toEqual(others);
    expect(props.drawn.peeked[1]).toBe(1);
    // the near edge (toward the seat, the far side of the table for seat 1) is the high one: the card is turned away from the middle
    const seat = ovalSeats(3)[1]!;
    const toSeat = new Vector3(-Math.sin(seat.facing), 0, -Math.cos(seat.facing));
    const edge = (m: Mesh, sign: number) => new Vector3(0, sign * HOLE_CARD.h / 2, 0).applyQuaternion(m.quaternion).add(m.position);
    const [a, b] = [edge(cards[0]!, 1), edge(cards[0]!, -1)];
    const nearer = a.clone().sub(b).dot(toSeat) > 0 ? a : b;
    const farther = nearer === a ? b : a;
    expect(nearer.y).toBeGreaterThan(farther.y);
  });

  it("puts them back flat, keeps the lift through a redraw, and never lifts a hand turned face up", () => {
    const props = make();
    props.setState(state());
    const flat = holeCards(props, 0).map((m) => m.position.toArray());
    props.setPeek(0, 1);
    props.setState({ ...state(), pot: 9 }); // another state: the cards are drawn again, still peeked at
    expect(holeCards(props, 0)[0]!.position.y).toBeGreaterThan(flat[0]![1]! + 0.04);
    props.setPeek(0, 0);
    expect(holeCards(props, 0).map((m) => m.position.toArray())).toEqual(flat);
    props.setPeek(0, 1);
    props.setState(state("showdown"));
    expect(holeCards(props, 0)[0]!.position.y, "face up at the showdown: not lifted").toBeLessThan(flat[0]![1]! + 0.01);
  });
});
