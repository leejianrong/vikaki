import { describe, expect, it, vi } from "vitest";
import { AudioSession } from "./audio-session.ts";
import type { CreatedMouth } from "./mouth.ts";

/** Stand-ins for the browser's AudioContext and the lip-sync driver, so the setup order can be tested. */
function fakes(mouthDelayMs = 20) {
  const ctx = { state: "suspended", resume: vi.fn(async () => void (ctx.state = "running")) };
  const created: CreatedMouth = { kind: "wlipsync", driver: { weights: {}, volume: 0, connect() {}, mute() {}, unmute() {} } };
  const createContext = vi.fn(() => ctx as unknown as AudioContext);
  const createMouth = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, mouthDelayMs));
    return created;
  });
  return { ctx, createContext, createMouth };
}

describe("AudioSession setup", () => {
  it("creates one context and one mouth driver however many callers ask at once", async () => {
    const f = fakes();
    const s = new AudioSession("profile", { createContext: f.createContext, createMouth: f.createMouth });
    await Promise.all([s.prepare(), s.prepare(), s.prepare()]);
    expect(f.createContext).toHaveBeenCalledTimes(1);
    expect(f.createMouth).toHaveBeenCalledTimes(1);
  });

  it("does not say it is running until the mouth driver is ready, even if the context already is", async () => {
    const f = fakes(60);
    const s = new AudioSession("profile", { createContext: f.createContext, createMouth: f.createMouth });
    const pending = s.prepare();
    f.ctx.state = "running"; // a click let the browser start the context while the driver is still loading
    expect(s.running).toBe(false);
    expect(() => s.webOutput()).toThrow(/prepare/);
    await pending;
    expect(s.running).toBe(true);
    expect(() => s.webOutput()).not.toThrow();
  });

  it("is not running before setup, or while the browser is holding audio", async () => {
    const f = fakes();
    f.ctx.resume = vi.fn(async () => {}); // the browser refuses: state stays "suspended"
    const s = new AudioSession("profile", { createContext: f.createContext, createMouth: f.createMouth });
    expect(s.running).toBe(false);
    await s.prepare();
    expect(s.running).toBe(false);
  });

  it("lets a later call retry after a failed setup", async () => {
    const f = fakes();
    let calls = 0;
    const createMouth = vi.fn(async () => {
      if (++calls === 1) throw new Error("profile did not load");
      return f.createMouth();
    });
    const s = new AudioSession("profile", { createContext: f.createContext, createMouth });
    await expect(s.prepare()).rejects.toThrow("profile did not load");
    await expect(s.prepare()).resolves.toBeUndefined();
    expect(s.running).toBe(true);
  });
});
