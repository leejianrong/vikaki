import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GUTTER, layoutLanes, spectrogramPixels, tickStep, timeToX, utteranceSignal, waveformColumns, xToTime, type Signal, type View } from "./timeline-draw.ts";
import type { UtteranceTimeline } from "./timeline.ts";

const view: View = { fromMs: 1000, toMs: 3000, originMs: 1000 };

describe("lane layout", () => {
  it("stacks the lanes top to bottom without overlap, inside the height", () => {
    for (const height of [120, 250, 400, 900]) {
      const lanes = layoutLanes(height);
      expect(lanes.map((l) => l.id)).toEqual(["axis", "words", "wave", "spec", "mouth", "events"]);
      lanes.forEach((l, i) => {
        if (i > 0) expect(l.top).toBeGreaterThanOrEqual(lanes[i - 1]!.top + lanes[i - 1]!.height + 4); // a visible gap
        expect(l.top + l.height).toBeLessThanOrEqual(height);
      });
    }
  });

  it("gives the spectrogram and the mouth the most room, and the words, wave and events the least", () => {
    const lanes = layoutLanes(400);
    const h = (id: string) => lanes.find((l) => l.id === id)!.height;
    for (const big of ["spec", "mouth"]) for (const small of ["words", "wave", "events"]) expect(h(big)).toBeGreaterThan(h(small));
  });

  it("copes with a tiny canvas", () => {
    expect(layoutLanes(10).every((l) => l.height >= 0)).toBe(true);
  });
});

describe("time and pixels", () => {
  it("maps the ends of the view to the plot edges, and back", () => {
    expect(timeToX(1000, view, 864)).toBe(GUTTER);
    expect(timeToX(3000, view, 864)).toBe(864);
    expect(xToTime(timeToX(1700, view, 864), view, 864)).toBeCloseTo(1700, 6);
  });

  it("round-trips for any time and width", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.integer({ min: 100, max: 4000 }), (t, w) => Math.abs(xToTime(timeToX(t, view, w), view, w) - t) < 1e-6));
  });

  it("picks a round tick step that leaves at most 12 ticks", () => {
    expect(tickStep(10_000)).toBe(1000);
    expect(tickStep(2000)).toBe(200);
    expect(tickStep(300)).toBe(50);
    fc.assert(fc.property(fc.double({ min: 1, max: 1e6, noNaN: true }), (span) => span / tickStep(span) <= 12 || tickStep(span) === 60_000));
  });
});

const tone = (seconds: number, rate: number, amp = 0.5): Float32Array => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / rate));

describe("signal of an utterance", () => {
  const u = (parts: { startMs: number; samples: Float32Array }[]): UtteranceTimeline => ({
    id: "u",
    startMs: 0,
    endMs: 9999,
    pieces: [],
    audio: parts.map((p) => ({ ...p, sampleRate: 1000 })),
  });

  it("puts each slice where it was heard, with silence in any gap", () => {
    const s = utteranceSignal(u([{ startMs: 100, samples: new Float32Array(200).fill(0.5) }, { startMs: 500, samples: new Float32Array(100).fill(-0.5) }]))!;
    expect(s.startMs).toBe(100);
    expect(s.samples).toHaveLength(500);
    expect([s.samples[0], s.samples[199], s.samples[200], s.samples[399], s.samples[400], s.samples[499]]).toEqual([0.5, 0.5, 0, 0, -0.5, -0.5]);
  });

  it("has nothing for an utterance with no audio", () => {
    expect(utteranceSignal(u([]))).toBeUndefined();
  });
});

describe("waveform columns", () => {
  const signal: Signal = { startMs: 1000, rate: 1000, samples: Float32Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0.8 : -0.4)) };
  it("shows the extremes of each column and nothing where there is no audio", () => {
    const w = waveformColumns([signal], { fromMs: 500, toMs: 2500, originMs: 500 }, 20); // 100 ms per column; audio is 1000 to 2000
    expect(Array.from(w.has)).toEqual([...Array(5).fill(0), ...Array(10).fill(1), ...Array(5).fill(0)]);
    expect(w.max[5]).toBeCloseTo(0.8);
    expect(w.min[5]).toBeCloseTo(0.8);
    expect(w.min[14]).toBeCloseTo(-0.4);
  });
});

describe("spectrogram pixels", () => {
  const rate = 16000;
  it("is lit only where there is audio, and brightest at the tone's frequency", () => {
    const signal: Signal = { startMs: 1000, rate, samples: tone(1, rate) }; // 440 Hz for 1 s from t=1000 ms
    const cols = 100;
    const rows = 64;
    const px = spectrogramPixels([signal], { fromMs: 500, toMs: 2500, originMs: 500 }, cols, rows);
    const alpha = (c: number, r: number) => px[(r * cols + c) * 4 + 3]!;
    const bright = (c: number, r: number) => px[(r * cols + c) * 4]! + px[(r * cols + c) * 4 + 1]! + px[(r * cols + c) * 4 + 2]!;
    expect(alpha(5, 10)).toBe(0); // before the audio
    expect(alpha(95, 10)).toBe(0); // after it
    expect(alpha(50, 10)).toBe(255); // during
    // 440 Hz of 8000 Hz is 5.5% of the way up, so about 3.5 rows from the bottom: brighter than a row halfway up
    const lowRow = rows - 1 - Math.round(0.055 * rows);
    expect(bright(50, lowRow)).toBeGreaterThan(bright(50, 20) + 100);
  });

  it("is centred on the audio: each frame is drawn at the middle of its window, not its start", () => {
    const signal: Signal = { startMs: 1000, rate, samples: tone(1, rate) }; // audio spans 1000 to 2000 ms
    const cols = 750;
    const px = spectrogramPixels([signal], { fromMs: 750, toMs: 2250, originMs: 750 }, cols, 8); // 2 ms per column
    const lit = Array.from({ length: cols }, (_, c) => c).filter((c) => px[c * 4 + 3] === 255);
    const centre = 750 + ((lit[0]! + lit[lit.length - 1]! + 1) / 2) * 2;
    expect(Math.abs(centre - 1500)).toBeLessThanOrEqual(6);
  });
});
