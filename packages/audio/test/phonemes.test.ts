import { describe, expect, it } from "vitest";
import { alignPhonemes, tokenizeIpa } from "../src/phonemes.ts";

const RATE = 16000;

/** Tone bursts at known times, silence between: a stand-in for words with real gaps. `bursts` are [startSec, endSec]. */
function bursts(total: number, spans: [number, number][]): Float32Array {
  const out = new Float32Array(Math.round(total * RATE));
  for (const [a, b] of spans) {
    for (let i = Math.round(a * RATE); i < Math.min(out.length, Math.round(b * RATE)); i++) out[i] = 0.4 * Math.sin((2 * Math.PI * 180 * i) / RATE) * (1 + 0.3 * Math.sin((2 * Math.PI * 4 * i) / RATE));
  }
  return out;
}

describe("tokenizeIpa", () => {
  it("splits a word into sounds; stress belongs to the next sound and length to the one before", () => {
    expect(tokenizeIpa("həlˈoʊ").map((t) => [t.p, t.stress])).toEqual([["h", 0], ["ə", 0], ["l", 0], ["o", 1], ["ʊ", 0]]);
    expect(tokenizeIpa("wˈɜːld").map((t) => t.p)).toEqual(["w", "ɜː", "l", "d"]);
  });
  it("weights a stressed long vowel above a schwa and a stop", () => {
    const [h, schwa, , o] = tokenizeIpa("həlˈoʊ");
    expect(o!.weight).toBeGreaterThan(schwa!.weight);
    expect(schwa!.weight).toBeGreaterThan(0);
    expect(h!.weight).toBeGreaterThan(0);
  });
});

describe("alignPhonemes", () => {
  const ipa = "həlˈoʊ wˈɜːld";
  const audio = bursts(1.6, [[0.2, 0.7], [0.95, 1.5]]); // two words with a 250 ms gap

  it("puts each word's sounds inside its own stretch of sound, none in the gap", () => {
    const spans = alignPhonemes(ipa, audio, RATE);
    expect(spans.map((s) => s.p).join("")).toBe("həloʊwɜːld");
    const first = spans.slice(0, 5);
    const second = spans.slice(5);
    expect(first[0]!.t).toBeGreaterThanOrEqual(150);
    expect(first.at(-1)!.t + first.at(-1)!.d).toBeLessThanOrEqual(760);
    expect(second[0]!.t).toBeGreaterThanOrEqual(880);
    expect(second.at(-1)!.t + second.at(-1)!.d).toBeLessThanOrEqual(1560);
  });

  it("keeps spans in order, without overlap, and marks the stressed sounds", () => {
    const spans = alignPhonemes(ipa, audio, RATE);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.t, `${i}`).toBeGreaterThanOrEqual(spans[i - 1]!.t + spans[i - 1]!.d);
    for (const s of spans) expect(s.d).toBeGreaterThan(0);
    expect(spans.filter((s) => s.s === 1).map((s) => s.p)).toEqual(["o", "ɜː"]);
  });

  it("gives a long vowel more time than a short one in the same word", () => {
    const spans = alignPhonemes("wˈɜːld", bursts(0.8, [[0.1, 0.7]]), RATE);
    const byP = Object.fromEntries(spans.map((s) => [s.p, s.d]));
    expect(byP["ɜː"]).toBeGreaterThan(byP["d"]!);
  });

  it("gives nothing for no phonemes or for silence, and does not throw on odd input", () => {
    expect(alignPhonemes("", audio, RATE)).toEqual([]);
    expect(alignPhonemes(ipa, new Float32Array(0), RATE)).toEqual([]);
    expect(alignPhonemes(" , | . ", audio, RATE)).toEqual([]);
    const silent = alignPhonemes(ipa, new Float32Array(RATE), RATE);
    for (let i = 1; i < silent.length; i++) expect(silent[i]!.t).toBeGreaterThanOrEqual(silent[i - 1]!.t);
  });

  it("a pause mark in the text makes room for the pause", () => {
    const withPause = alignPhonemes("ɡʊd, wˈɜːld", bursts(2, [[0.1, 0.5], [1.0, 1.6]]), RATE);
    const good = withPause.slice(0, 3);
    expect(good.at(-1)!.t + good.at(-1)!.d).toBeLessThanOrEqual(560);
    expect(withPause[3]!.t).toBeGreaterThanOrEqual(900);
  });
});
