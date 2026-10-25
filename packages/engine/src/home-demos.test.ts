import { describe, expect, it } from "vitest";
import { demos, seatCount } from "./home-demos.ts";

describe("the landing page's demos", () => {
  it("seat as many as the hub has characters, between 2 and 8, and three when it has none", () => {
    expect([0, 1, 2, 3, 6, 8, 12].map(seatCount)).toEqual([3, 3, 2, 3, 6, 8, 8]);
  });

  it("lead with the poker table, and link only to pages the avatar page serves", () => {
    const d = demos(3);
    expect(d[0]).toMatchObject({ title: "Poker table", href: "/avatar?seats=3&view=table" });
    expect(d.map((x) => x.href)).toEqual(["/avatar?seats=3&view=table", "/avatar?seats=3", "/avatar?demo=speech&live=1", "/avatar?demo=speech&live=1&mouth=hybrid", "/avatar?demo=1"]);
    expect(new Set(d.map((x) => x.title)).size).toBe(d.length);
  });
});
