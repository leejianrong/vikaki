import { describe, expect, it } from "vitest";
import { FRAME_FIELDS, MOUTH_SHAPES, TimelineRecorder } from "./timeline.ts";

/** A recorder whose clock the test moves. The clock starts at 1000 so timeline time 0 is not the raw reading. */
function make(options: ConstructorParameters<typeof TimelineRecorder>[0] = {}) {
  let clock = 1000;
  const rec = new TimelineRecorder({ now: () => clock, ...options });
  return { rec, at: (ms: number) => (clock = 1000 + ms) };
}
const samples = (seconds: number, rate = 1000) => new Float32Array(Math.round(seconds * rate)).fill(0.5);

describe("frames", () => {
  it("stores the commanded and applied mouth, volume and blink for each frame, against timeline time", () => {
    const { rec, at } = make();
    at(16);
    rec.frame({ aa: 0.5, oh: 0.25 }, { aa: 0.4 }, 0.8, 0.1);
    const f = rec.frames();
    expect(f.count).toBe(1);
    expect(f.t[0]).toBe(16);
    expect([...f.data]).toEqual([0.5, 0, 0, 0, 0.25, 0.4, 0, 0, 0, 0, 0.8, 0.1].map((v) => Math.fround(v)));
    expect(f.data.length).toBe(FRAME_FIELDS);
    expect(MOUTH_SHAPES).toEqual(["aa", "ih", "ou", "ee", "oh"]);
  });

  it("keeps only the newest frames once full, oldest dropped, still in order", () => {
    const { rec, at } = make({ maxFrames: 4 });
    for (let i = 0; i < 6; i++) {
      at(i * 10);
      rec.frame({ aa: i / 10 }, {}, 0, 0);
    }
    const f = rec.frames();
    expect([...f.t]).toEqual([20, 30, 40, 50]);
    expect(Array.from({ length: 4 }, (_, i) => f.data[i * FRAME_FIELDS]!)).toEqual([0.2, 0.3, 0.4, 0.5].map((v) => Math.fround(v)));
    expect(rec.frameCount).toBe(4);
  });

  it("returns just the frames inside a time range", () => {
    const { rec, at } = make();
    for (let i = 0; i < 10; i++) {
      at(i * 10);
      rec.frame({}, {}, 0, 0);
    }
    expect([...rec.frames(25, 55).t]).toEqual([30, 40, 50]);
    expect([...rec.frames(30, 50).t]).toEqual([30, 40, 50]); // both ends are inclusive
    expect(rec.frames(500, 600).count).toBe(0);
  });
});

describe("speech on the timeline", () => {
  it("groups slices into pieces with their text, start and end", () => {
    const { rec } = make();
    rec.scheduled({ utteranceId: "u", sentenceIndex: 0, sentenceText: "Hello.", startPerfMs: 1500, samples: samples(1), sampleRate: 1000 });
    rec.scheduled({ utteranceId: "u", sentenceIndex: 0, startPerfMs: 2500, samples: samples(0.5), sampleRate: 1000 });
    rec.scheduled({ utteranceId: "u", sentenceIndex: 1, sentenceText: "How are you?", startPerfMs: 3000, samples: samples(2), sampleRate: 1000 });
    const u = rec.utterance("u")!;
    expect(u.pieces).toEqual([
      { index: 0, text: "Hello.", startMs: 500, endMs: 2000 },
      { index: 1, text: "How are you?", startMs: 2000, endMs: 4000 },
    ]);
    expect([u.startMs, u.endMs]).toEqual([500, 4000]);
    expect(u.audio.map((a) => a.startMs)).toEqual([500, 1500, 2000]);
  });

  it("treats slices with no sentence information as one unnamed piece", () => {
    const { rec } = make();
    rec.scheduled({ utteranceId: "u", startPerfMs: 1000, samples: samples(1), sampleRate: 1000 });
    expect(rec.utterance("u")!.pieces).toEqual([{ index: 0, text: "", startMs: 0, endMs: 1000 }]);
  });

  it("when playback is interrupted, drops what was never heard and clips what was cut", () => {
    const { rec, at } = make();
    rec.scheduled({ utteranceId: "u", sentenceIndex: 0, sentenceText: "One.", startPerfMs: 1000, samples: samples(2), sampleRate: 1000 });
    rec.scheduled({ utteranceId: "u", sentenceIndex: 1, sentenceText: "Two.", startPerfMs: 3000, samples: samples(2), sampleRate: 1000 });
    at(1500);
    rec.event("interrupted", "u");
    const u = rec.utterance("u")!;
    expect(u.interruptedAtMs).toBe(1500);
    expect(u.pieces).toEqual([{ index: 0, text: "One.", startMs: 0, endMs: 1500 }]);
    expect(u.audio).toHaveLength(1);
    expect(u.audio[0]!.samples).toHaveLength(1500);
    expect(u.endMs).toBe(1500);
  });

  it("keeps only the newest utterances", () => {
    const { rec } = make({ maxUtterances: 2 });
    for (const id of ["a", "b", "c"]) rec.scheduled({ utteranceId: id, startPerfMs: 1000, samples: samples(1), sampleRate: 1000 });
    expect(rec.utterances().map((u) => u.id)).toEqual(["b", "c"]);
  });
});

describe("events", () => {
  it("are stamped on the timeline clock, in order, and capped", () => {
    const { rec, at } = make({ maxEvents: 3 });
    for (const [t, kind] of [[0, "sent"], [100, "started"], [200, "finished"], [300, "blink"]] as const) {
      at(t);
      rec.event(kind, "u");
    }
    expect(rec.events().map((e) => [e.t, e.kind])).toEqual([[100, "started"], [200, "finished"], [300, "blink"]]);
  });
});

describe("export", () => {
  it("lists frames as [t, ...fields], events and utterances; audio only when asked", () => {
    const { rec, at } = make();
    at(10);
    rec.frame({ aa: 1 }, { aa: 0.9 }, 0.5, 0);
    rec.event("started", "u");
    rec.scheduled({ utteranceId: "u", sentenceIndex: 0, sentenceText: "Hi.", startPerfMs: 1010, samples: samples(0.5), sampleRate: 1000 });
    const plain = rec.toJSON();
    expect(plain.frames[0]).toEqual([10, 1, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0.5, 0]);
    expect(plain.events).toEqual([{ t: 10, kind: "started", utteranceId: "u" }]);
    expect(plain.utterances[0]).toMatchObject({ id: "u", pieces: [{ index: 0, text: "Hi.", startMs: 10, endMs: 510 }] });
    expect(plain.utterances[0]!.audio[0]).toEqual({ startMs: 10, sampleRate: 1000, seconds: 0.5 });
    expect(rec.toJSON({ includeAudio: true }).utterances[0]!.audio[0]).toHaveProperty("pcm");
    expect(rec.toJSON({ fromMs: 1000 }).frames).toEqual([]);
  });
});
