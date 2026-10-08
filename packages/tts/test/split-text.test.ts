import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gapAfter, splitLong, trimSilence } from "../src/split-text.mjs";

describe("splitLong", () => {
  it("leaves a text that is short enough alone", () => {
    expect(splitLong("Hello there, friend.", 70)).toEqual(["Hello there, friend."]);
    expect(splitLong("", 70)).toEqual([]);
    expect(splitLong("   ", 70)).toEqual([]);
  });

  it("lets a comma cut run a little past the limit, rather than cutting a phrase in two at a space", () => {
    // the comma after "budget" is at 72 characters, just past 70: better a piece of 72 than "discuss the | budget,"
    const text = "When the committee finally met on Tuesday morning to discuss the budget, nobody had read the report that everybody had been sent, so the meeting ran long.";
    expect(splitLong(text, 70)[0]).toBe("When the committee finally met on Tuesday morning to discuss the budget,");
  });

  it("cuts a long sentence at a comma rather than in the middle of a clause", () => {
    const text = "When the committee finally met on Tuesday morning to discuss the budget, nobody had read the report that everybody had been sent.";
    expect(splitLong(text, 80)).toEqual(["When the committee finally met on Tuesday morning to discuss the budget,", "nobody had read the report that everybody had been sent."]);
  });

  it("prefers a stronger break (semicolon, colon, dash) over a comma, and a comma over a conjunction", () => {
    expect(splitLong("The first part runs on for quite a while, with a comma in it; and then the second part follows after that.", 70)[0]).toMatch(/;$/);
    expect(splitLong("We went down to the old harbour at dawn, and then we walked all the way back home again slowly.", 60)[0]).toMatch(/dawn,$/);
  });

  it("with no punctuation, cuts before a conjunction, and failing that at a space", () => {
    const text = "we walked down to the harbour and watched the boats come in while the gulls circled overhead and screamed";
    const pieces = splitLong(text, 50);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.slice(1).some((p) => /^(and|while|but|so) /.test(p))).toBe(true);
    expect(pieces.every((p) => p.length <= 62)).toBe(true);
  });

  it("does not make tiny pieces: nothing below the minimum unless it is the last", () => {
    const text = "Yes, indeed, and so it goes, on and on, with short clauses, piling up, one after another, until the end of the line.";
    const pieces = splitLong(text, 60, 20);
    for (const p of pieces.slice(0, -1)) expect(p.length).toBeGreaterThanOrEqual(20);
  });

  it("cuts a word longer than the limit rather than looping", () => {
    expect(splitLong("a".repeat(150), 60).join("")).toBe("a".repeat(150));
    expect(splitLong("a".repeat(150), 60).every((p) => p.length <= 60)).toBe(true); // no punctuation to run past for
  });

  it("keeps every word, in order, whatever the text (property)", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom("a", "b", "c", "d", "e", " ", " ", ",", ".", ";", "-", "'") , maxLength: 400 }), fc.integer({ min: 30, max: 120 }), (text, max) => {
        const pieces = splitLong(text, max);
        expect(pieces.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, "")); // every character, in order (a cut inside a huge word may not keep its space)
        for (const p of pieces) expect(p.length).toBeLessThanOrEqual(Math.floor(max * 1.25)); // a punctuation cut may run a quarter past the limit
      }),
      { numRuns: 300 },
    );
  });
});

describe("gapAfter", () => {
  it("is a natural pause after a stronger or comma cut, and a breath after a cut with no punctuation", () => {
    expect(gapAfter("It rained all week;")).toBeGreaterThan(gapAfter("It rained all week,"));
    expect(gapAfter("It rained all week,")).toBeGreaterThan(gapAfter("It rained all week and"));
    expect(gapAfter("It rained all week and")).toBeGreaterThan(0);
    expect(gapAfter("It rained all week,")).toBeLessThan(0.4);
  });
});

describe("trimSilence", () => {
  const rate = 24000;
  const tone = (seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate));
  const silence = (seconds: number) => new Float32Array(Math.round(rate * seconds));
  const join = (...parts: Float32Array[]) => Float32Array.from(parts.flatMap((p) => [...p]));

  it("cuts the quiet at either end down to a short margin, and leaves the sound alone", () => {
    const padded = join(silence(0.4), tone(1), silence(0.5));
    const trimmed = trimSilence(padded, rate, 0.03);
    const seconds = trimmed.length / rate;
    expect(seconds).toBeGreaterThan(1.0 + 0.03 * 2 - 0.02); // the sound plus a margin each side
    expect(seconds).toBeLessThan(1.0 + 0.03 * 2 + 0.03);
    const loud = tone(1).findIndex((v) => Math.abs(v) >= 0.005); // a sine starts at exactly zero, which is quiet
    expect(Array.from(trimmed.slice(Math.round(0.03 * rate) + 100, Math.round(0.03 * rate) + 110))).toEqual(Array.from(tone(1).slice(loud + 100, loud + 110))); // the sound is untouched
  });

  it("leaves quiet in the middle of speech alone", () => {
    const text = join(tone(0.5), silence(0.3), tone(0.5));
    expect(trimSilence(text, rate, 0.03).length).toBeGreaterThanOrEqual(text.length - 2);
  });

  it("leaves a piece with no edge silence the same length, and a wholly silent piece short but not empty", () => {
    expect(trimSilence(tone(1), rate, 0.03).length).toBe(tone(1).length);
    const quiet = trimSilence(silence(1), rate, 0.03);
    expect(quiet.length).toBeGreaterThan(0);
    expect(quiet.length).toBeLessThanOrEqual(Math.round(0.07 * rate));
  });
});
