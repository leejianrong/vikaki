import { describe, expect, it } from "vitest";
import { StateHistory } from "./state-history.ts";

const filled = (n: number, limit?: number) => {
  const h = new StateHistory<number>(limit);
  for (let i = 1; i <= n; i++) h.push(i);
  return h;
};

describe("StateHistory", () => {
  it("shows each new state while live", () => {
    const h = new StateHistory<number>();
    expect(h.push(1)).toBe(1);
    expect(h.push(2)).toBe(2);
    expect([h.reviewing, h.position, h.length]).toEqual([false, 2, 2]);
  });

  it("steps back one state at a time, holds the newest ones back, and stops at the first", () => {
    const h = filled(3);
    expect(h.back()).toBe(2);
    expect(h.back()).toBe(1);
    expect(h.back()).toBeUndefined();
    expect([h.reviewing, h.position]).toEqual([true, 1]);
    expect(h.push(4)).toBeUndefined(); // a reviewer is not pulled to the new state
    expect(h.length).toBe(4);
  });

  it("steps forward through what was held back and is live again at the newest", () => {
    const h = filled(4);
    h.back();
    h.back();
    expect(h.forward()).toBe(3);
    expect(h.reviewing).toBe(true);
    expect(h.forward()).toBe(4);
    expect(h.reviewing).toBe(false);
    expect(h.forward()).toBeUndefined();
  });

  it("goes live at once and hands back the newest state", () => {
    const h = filled(5);
    h.back();
    h.back();
    expect(h.live()).toBe(5);
    expect([h.reviewing, h.position]).toEqual([false, 5]);
  });

  it("keeps only the last `limit` states, and a reviewer keeps their place", () => {
    const h = filled(5, 5);
    h.back();
    h.push(6);
    expect(h.length).toBe(5);
    expect(h.position).toBe(3); // still looking at the state that was 4, which is now third
    expect(h.back()).toBe(3);
  });
});
