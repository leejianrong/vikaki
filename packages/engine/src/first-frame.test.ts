import { describe, expect, it } from "vitest";
import { FirstFrameTimer } from "./first-frame.ts";

describe("FirstFrameTimer", () => {
  it("times the first sound and the first open-mouth frame from when the line arrived", () => {
    const t = new FirstFrameTimer();
    t.received("a", 1000);
    t.heard("a", 1600);
    t.frame(1610, 0.01); // still closed
    t.frame(1650, 0.4);
    t.frame(1700, 0.6); // later frames do not move it
    expect(t.take("a")).toEqual({ audio_ms: 600, frame_ms: 650 });
  });

  it("ignores open-mouth frames from before the line was heard", () => {
    const t = new FirstFrameTimer();
    t.received("a", 0);
    t.frame(50, 0.9); // the mic or an earlier line
    t.heard("a", 100);
    t.frame(140, 0.5);
    expect(t.take("a")).toEqual({ audio_ms: 100, frame_ms: 140 });
  });

  it("leaves the frame out when the line ended before one was drawn, and forgets a line that was never heard", () => {
    const t = new FirstFrameTimer();
    t.received("a", 0);
    t.heard("a", 30);
    expect(t.take("a")).toEqual({ audio_ms: 30 });
    t.received("b", 0);
    expect(t.take("b")).toBeUndefined();
    expect(t.take("a")).toBeUndefined();
  });

  it("keeps the first arrival if the page hears about a line twice", () => {
    const t = new FirstFrameTimer();
    t.received("a", 10);
    t.received("a", 500);
    t.heard("a", 110);
    expect(t.take("a")).toEqual({ audio_ms: 100 });
  });
});
