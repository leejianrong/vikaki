import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioSession } from "./audio-session.ts";
import { SOUND_NAMES } from "./sfx-cues.ts";
import { RECIPES, Sfx } from "./sfx.ts";

const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
/** Just enough of an AudioContext to run the recipes, counting the sources that were started. */
function fakeContext() {
  const started: number[] = [];
  const node = (): Record<string, unknown> => {
    const n: Record<string, unknown> = { gain: param(), frequency: param(), Q: param(), connect: (to: unknown) => to, start: (t: number) => started.push(t), stop() {}, getChannelData: () => new Float32Array(8) };
    return n;
  };
  const ctx = { currentTime: 10, sampleRate: 8, destination: node(), createGain: node, createBiquadFilter: node, createOscillator: node, createBufferSource: node, createBuffer: node } as unknown as AudioContext;
  return { ctx, started };
}
const session = (ctx?: AudioContext) => ({ context: ctx }) as unknown as AudioSession;

afterEach(() => vi.unstubAllGlobals());

describe("the recipes", () => {
  it("every sound is made of something and starts at or after the time asked", () => {
    for (const name of SOUND_NAMES) {
      const { ctx, started } = fakeContext();
      RECIPES[name]({ ctx, out: ctx.destination, noise: ctx.createBuffer(1, 8, 8) }, 5);
      expect(started.length, name).toBeGreaterThan(0);
      expect(Math.min(...started), name).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("Sfx", () => {
  it("waits for the browser to allow sound, but still notes the cue", () => {
    const sfx = new Sfx(session(undefined));
    sfx.play([{ sound: "chips", at: 0 }]);
    expect(sfx.cues).toEqual(["chips"]);
  });

  it("plays each cue after its delay on the audio clock", () => {
    const { ctx, started } = fakeContext();
    new Sfx(session(ctx)).play([{ sound: "tick", at: 0.5 }]);
    expect(started).toEqual([10.5]);
  });

  it("makes no sound, and notes nothing, when muted or at zero volume", () => {
    const { ctx, started } = fakeContext();
    const sfx = new Sfx(session(ctx));
    sfx.set({ muted: true });
    sfx.play([{ sound: "win", at: 0 }]);
    sfx.set({ muted: false, volume: 0 });
    sfx.play([{ sound: "win", at: 0 }]);
    expect(started).toEqual([]);
    expect(sfx.cues).toEqual([]);
  });

  it("remembers the volume and the mute, and copes with no storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    new Sfx(session()).set({ volume: 0.3, muted: true });
    const again = new Sfx(session());
    expect([again.volume, again.muted]).toEqual([0.3, true]);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    const blocked = new Sfx(session());
    expect(blocked.volume).toBe(0.6);
    expect(() => blocked.set({ volume: 0.2 })).not.toThrow();
  });
});
