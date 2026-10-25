import { describe, expect, it } from "vitest";
import { parseMouthMode, PhonemeMouth } from "./phoneme-mouth.ts";
import { PhonemeTrack } from "./phoneme-track.ts";
import { shapeOf, weightsFor } from "./phoneme-visemes.ts";
import type { MouthDriver } from "./mouth.ts";

describe("shapes", () => {
  it("each vowel picks its own shape, and the lips-together sounds close the mouth", () => {
    expect(Object.keys(weightsFor("ɑ", 1))).toEqual(["aa"]);
    expect(Object.keys(weightsFor("u", 1))).toEqual(["ou"]);
    expect(Object.keys(weightsFor("i", 1))).toEqual(["ih"]);
    expect(weightsFor("o", 1).oh).toBeGreaterThan(0.5);
    for (const c of ["p", "b", "m"]) expect(weightsFor(c, 1), c).toEqual({});
  });

  it("a stressed sound opens wider than an unstressed one, and a schwa is quiet", () => {
    expect(weightsFor("a", 1).aa!).toBeGreaterThan(weightsFor("a", 0).aa!);
    expect(weightsFor("ə", 0).ee!).toBeLessThan(weightsFor("ɛ", 0).ee!);
  });

  it("articulation scales the whole mouth, and no weight passes 1", () => {
    expect(weightsFor("a", 1, 1).aa!).toBeGreaterThan(weightsFor("a", 1, 0.4).aa!);
    for (const p of ["a", "æ", "o", "u", "ɛ", "s", "w"]) for (const w of Object.values(weightsFor(p, 1, 1))) expect(w).toBeLessThanOrEqual(1);
  });

  it("a long vowel keeps its shape (the length mark is not a different sound), and an unknown sound is a small neutral opening", () => {
    expect(shapeOf("ɜː")).toEqual(shapeOf("ɜ"));
    expect(Object.values(shapeOf("ʘ").weights).every((w) => w <= 0.25)).toBe(true);
  });
});

/** An audio mouth that says what it is told, to see what the phoneme mouth takes from it. */
function inner(): MouthDriver & { w: Record<string, number>; v: number; muted: number } {
  const m = {
    w: { aa: 0.5 } as Record<string, number>,
    v: 0.5,
    muted: 0,
    get weights() {
      return m.w;
    },
    get volume() {
      return m.v;
    },
    connect() {},
    mute() {
      m.muted++;
    },
    unmute() {},
  };
  return m;
}

function setup(mode: "phoneme" | "hybrid", track = new PhonemeTrack(), options: { lead?: number } = {}) {
  let now = 10_000;
  const audio = inner();
  const mouth = new PhonemeMouth(audio, track, { mode, lead: 0, clock: () => now, ...options });
  /** Step the clock by `ms` in 16 ms frames and read the weights at the end. */
  const run = (ms: number) => {
    let w = mouth.weights;
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      w = mouth.weights;
    }
    return w;
  };
  return { track, audio, mouth, run, at: () => now };
}

describe("PhonemeMouth", () => {
  it("opens to the shape of the sound being spoken and closes in a gap, easing between", () => {
    const s = setup("phoneme");
    const t0 = s.at();
    s.track.add("u", t0 + 100, [{ p: "a", t: 0, d: 300 }, { p: "u", t: 500, d: 300 }]); // a gap of 200 ms between them
    expect(s.run(50).aa ?? 0).toBeLessThan(0.05); // before the first sound
    const a = s.run(200); // inside the a
    expect(a.aa!).toBeGreaterThan(0.5);
    expect(a.ou!).toBeLessThan(0.1);
    const gap = s.run(300); // inside the gap
    expect(gap.aa!).toBeLessThan(0.1);
    const u = s.run(250); // inside the u
    expect(u.ou!).toBeGreaterThan(0.4);
    expect(u.aa!).toBeLessThan(0.1);
  });

  it("moves smoothly: no weight jumps by more than a frame's share", () => {
    const s = setup("phoneme");
    s.track.add("u", s.at(), [{ p: "a", t: 0, d: 400 }, { p: "i", t: 400, d: 400 }]);
    let prev = 0;
    for (let i = 0; i < 60; i++) {
      s.run(16);
      const w = s.mouth.weights;
      const open = Math.max(w.aa ?? 0, w.ih ?? 0);
      expect(Math.abs(open - prev)).toBeLessThan(0.6);
      prev = open;
    }
  });

  it("falls back to the audio mouth when no phonemes are near, so a line without them is never still", () => {
    const s = setup("phoneme");
    expect(s.run(100)).toEqual({ aa: 0.5 }); // an empty track: whatever the audio mouth says
    s.track.add("u", s.at() + 5000, [{ p: "a", t: 0, d: 100 }]); // far in the future: still nothing near
    expect(s.run(100)).toEqual({ aa: 0.5 });
  });

  it("in hybrid, the shape is the phoneme's and the opening follows the voice's loudness", () => {
    const s = setup("hybrid");
    s.track.add("u", s.at(), [{ p: "a", t: 0, d: 2000 }]);
    s.audio.v = 1;
    const loud = s.run(300).aa!;
    s.audio.v = 0;
    const quiet = s.run(400).aa!;
    expect(loud).toBeGreaterThan(quiet);
    expect(quiet).toBeGreaterThan(0.1); // a floor: a quiet syllable still shows
    expect(s.mouth.weights.ou!).toBeLessThan(0.05); // and the shape is the phoneme's, not the audio mouth's
  });

  it("a cut-off shuts the mouth at once and mutes the audio mouth too", () => {
    const s = setup("phoneme");
    s.track.add("u", s.at(), [{ p: "a", t: 0, d: 2000 }]);
    expect(s.run(300).aa!).toBeGreaterThan(0.5);
    s.mouth.mute();
    s.run(16);
    expect(s.mouth.weights.aa ?? 0).toBe(0);
    expect(s.audio.muted).toBe(1);
    s.mouth.unmute();
    expect(s.run(300).aa!).toBeGreaterThan(0.5);
  });

  it("a lead makes the mouth shape a sound that much before it is heard", () => {
    const early = setup("phoneme", new PhonemeTrack(), { lead: 0.12 });
    early.track.add("u", early.at() + 100, [{ p: "a", t: 0, d: 300 }]);
    const late = setup("phoneme");
    late.track.add("u", late.at() + 100, [{ p: "a", t: 0, d: 300 }]);
    expect(early.run(48).aa!).toBeGreaterThan(0.1); // 48 ms in, the sound is 52 ms off: inside the lead
    expect(late.run(48).aa ?? 0).toBeLessThan(0.05);
  });

  it("answers repeated reads within a frame the same way", () => {
    const s = setup("phoneme");
    s.track.add("u", s.at(), [{ p: "a", t: 0, d: 2000 }]);
    s.run(200);
    expect(s.mouth.weights).toEqual(s.mouth.weights);
  });
});

describe("parseMouthMode", () => {
  it("takes the three names and anything else is the default", () => {
    expect(parseMouthMode("phoneme", "audio")).toBe("phoneme");
    expect(parseMouthMode("hybrid", "audio")).toBe("hybrid");
    expect(parseMouthMode("audio", "hybrid")).toBe("audio");
    for (const bad of [null, undefined, "", "Phoneme", "both"]) expect(parseMouthMode(bad, "hybrid")).toBe("hybrid");
  });
});

describe("vowelShape", () => {
  it("names the shape a vowel is mostly made with, and nothing for a consonant", async () => {
    const { vowelShape } = await import("./phoneme-visemes.ts");
    expect(vowelShape("a")).toBe(0);
    expect(vowelShape("ɪ")).toBe(1);
    expect(vowelShape("uː")).toBe(2);
    expect(vowelShape("ɛ")).toBe(3);
    expect(vowelShape("o")).toBe(4);
    expect(vowelShape("s")).toBeUndefined();
    expect(vowelShape("p")).toBeUndefined();
  });
});
