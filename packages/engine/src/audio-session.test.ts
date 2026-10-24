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

describe("the voices' level (VIK-109)", () => {
  /** A context with a gain node and buffer sources that remember where they were connected. */
  function playing() {
    const f = fakes();
    const gain = { gain: { value: 1 }, connect: vi.fn() };
    const sources: { connect: ReturnType<typeof vi.fn> }[] = [];
    const ctx = Object.assign(f.ctx, {
      destination: { name: "speakers" },
      currentTime: 0,
      createGain: () => gain,
      createBuffer: () => ({ copyToChannel() {} }),
      createBufferSource: () => {
        const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), buffer: null };
        sources.push(source);
        return source;
      },
    });
    const s = new AudioSession("profile", { createContext: () => ctx as unknown as AudioContext, createMouth: f.createMouth });
    return { s, gain, sources, ctx };
  }

  it("plays every line through one gain node, and a mute or a level change reaches the line already playing", async () => {
    const { s, gain, sources, ctx } = playing();
    await s.prepare();
    const out = s.webOutput();
    out.play(new Float32Array(10), 24000, 0);
    out.play(new Float32Array(10), 24000, 1); // a thought is played the same way
    expect(sources).toHaveLength(2);
    for (const src of sources) expect(src.connect).toHaveBeenCalledWith(gain); // not straight to the speakers
    expect(gain.connect).toHaveBeenCalledTimes(1);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    expect(gain.gain.value).toBe(1);
    s.setVoice({ volume: 0.4 });
    expect(gain.gain.value).toBe(0.4);
    s.setVoice({ muted: true });
    expect(gain.gain.value).toBe(0);
    expect(s.busGain).toBe(0);
    s.setVoice({ muted: false });
    expect(gain.gain.value).toBe(0.4); // back to the level it was set to
  });

  it("keeps the level inside 0 to 1 and applies it to a gain made later", async () => {
    const { s, gain } = playing();
    s.setVoice({ volume: 7 });
    expect(s.voice.volume).toBe(1);
    s.setVoice({ volume: -3, muted: false });
    expect(s.voice.volume).toBe(0);
    s.setVoice({ volume: 0.25, muted: true });
    await s.prepare();
    s.webOutput().play(new Float32Array(4), 24000, 0);
    expect(gain.gain.value).toBe(0); // muted before the first line: the node starts muted
    s.setVoice({ muted: false });
    expect(gain.gain.value).toBe(0.25);
  });

  it("works with a context that has no gain node, playing straight out as before", async () => {
    const f = fakes();
    const sources: { connect: ReturnType<typeof vi.fn> }[] = [];
    const ctx = Object.assign(f.ctx, { destination: { name: "speakers" }, currentTime: 0, createBuffer: () => ({ copyToChannel() {} }), createBufferSource: () => { const s = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), buffer: null }; sources.push(s); return s; } });
    const s = new AudioSession("profile", { createContext: () => ctx as unknown as AudioContext, createMouth: f.createMouth });
    await s.prepare();
    s.webOutput().play(new Float32Array(4), 24000, 0);
    expect(sources[0]!.connect).toHaveBeenCalledWith(ctx.destination);
  });
});
