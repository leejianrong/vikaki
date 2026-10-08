import { describe, expect, it } from "vitest";
import { MicTimeline } from "./mic-timeline.ts";
import { TimelineRecorder } from "./timeline.ts";

const RATE = 48000;
const WINDOW = 2048; // what the page reads from the analyser each time

/** A clock the test moves, and a recorder on it. */
function setup(options?: ConstructorParameters<typeof MicTimeline>[1]) {
  let t = 1000;
  const rec = new TimelineRecorder({ now: () => t });
  const mic = new MicTimeline(rec, options);
  /** The microphone: `loud(t)` says whether there is sound at page time t; the page reads the last WINDOW samples at each step. */
  const run = (fromMs: number, toMs: number, loud: (ms: number) => boolean, stepMs = 33) => {
    for (let ms = fromMs; ms <= toMs; ms += stepMs) {
      t = ms;
      const samples = Float32Array.from({ length: WINDOW }, (_, i) => {
        const at = ms - ((WINDOW - i) / RATE) * 1000; // when this sample was heard
        return loud(at) ? 0.3 * Math.sin((2 * Math.PI * 220 * at) / 1000) : 0;
      });
      mic.push(samples, RATE, ms);
    }
  };
  return { rec, mic, run, setTime: (ms: number) => (t = ms) };
}

const phrases = (rec: TimelineRecorder) => rec.utterances().filter((u) => u.id.startsWith("mic-"));
const seconds = (u: { audio: { samples: Float32Array; sampleRate: number }[] }) => u.audio.reduce((s, a) => s + a.samples.length / a.sampleRate, 0);

describe("MicTimeline", () => {
  it("records nothing from a quiet room", () => {
    const { rec, run } = setup();
    run(1000, 6000, () => false);
    expect(phrases(rec)).toEqual([]);
    expect(rec.events().filter((e) => e.kind.startsWith("mic:"))).toEqual([]);
  });

  it("records a stretch of sound as one phrase, with its audio and no words, and says when it began and ended", () => {
    const { rec, run } = setup();
    run(1000, 7000, (ms) => ms >= 2000 && ms < 4000);
    const [u, ...rest] = phrases(rec);
    expect(rest).toEqual([]);
    expect(u!.id).toBe("mic-1");
    expect(u!.pieces).toEqual([]); // the microphone has no text
    expect(u!.source).toBe("mic");
    // the recorder's clock starts at zero when it is made (page time 1000), so the sound that began at page time 2000 is at 1000 on it
    expect(u!.startMs).toBeGreaterThan(1000 - 400);
    expect(u!.startMs).toBeLessThan(1000 + 100);
    expect(seconds(u!)).toBeGreaterThan(2.0); // the sound, with a little before and after
    expect(seconds(u!)).toBeLessThan(3.4);
    const kinds = rec.events().filter((e) => e.utteranceId === "mic-1").map((e) => e.kind);
    expect(kinds).toEqual(["mic:started", "mic:finished"]);
  });

  it("holds the audio contiguously: slices follow one another with no repeats, as the analyser's windows overlap", () => {
    const { rec, run } = setup();
    run(1000, 5000, (ms) => ms >= 1500 && ms < 3500);
    const u = phrases(rec)[0]!;
    const placed = u.audio.slice().sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1]!;
      const gapMs = placed[i]!.startMs - (prev.startMs + (prev.samples.length / prev.sampleRate) * 1000);
      expect(Math.abs(gapMs), `between slices ${i - 1} and ${i}`).toBeLessThan(3); // next starts where the last ended
    }
  });

  it("makes two phrases of sound that are more than half a second apart, and one of sound that is less", () => {
    const apart = setup();
    apart.run(1000, 8000, (ms) => (ms >= 1500 && ms < 2500) || (ms >= 3500 && ms < 4500)); // a 1 s silence
    expect(phrases(apart.rec).map((u) => u.id)).toEqual(["mic-1", "mic-2"]);
    const close = setup();
    close.run(1000, 8000, (ms) => (ms >= 1500 && ms < 2500) || (ms >= 2800 && ms < 3800)); // a 0.3 s breath
    expect(phrases(close.rec)).toHaveLength(1);
  });

  it("keeps the audio at no more than 16 kHz, whatever the microphone's rate", () => {
    const { rec, run } = setup();
    run(1000, 4000, (ms) => ms >= 1500 && ms < 3000);
    for (const a of phrases(rec)[0]!.audio) expect(a.sampleRate).toBeLessThanOrEqual(16000);
    expect(phrases(rec)[0]!.audio[0]!.sampleRate).toBe(16000);
  });

  it("does not repeat or invent audio when the page stalls between two reads: the gap stays a gap", () => {
    const { rec, mic, setTime } = setup();
    const chunk = (ms: number) => Float32Array.from({ length: WINDOW }, (_, i) => 0.3 * Math.sin(i / 7 + ms));
    for (let ms = 1000; ms <= 1200; ms += 33) (setTime(ms), mic.push(chunk(ms), RATE, ms));
    setTime(1700); // half a second with no read
    mic.push(chunk(1700), RATE, 1700);
    const total = seconds(phrases(rec)[0]!);
    // 200 ms of steady reads (plus the first full window) and one window after the stall: never the 500 ms in between
    expect(total).toBeLessThan(0.2 + WINDOW / RATE + WINDOW / RATE + 0.06);
  });

  it("is limited in memory: past its budget the oldest phrases are forgotten and the newest kept", () => {
    const { rec, run } = setup({ budgetSeconds: 5 });
    for (let k = 0; k < 6; k++) run(1000 + k * 4000, 1000 + k * 4000 + 3500, (ms) => ms - (1000 + k * 4000) >= 300 && ms - (1000 + k * 4000) < 2300);
    const kept = phrases(rec);
    expect(kept.length).toBeLessThan(6);
    expect(kept.at(-1)!.id).toBe("mic-6");
    expect(kept.reduce((s, u) => s + seconds(u), 0)).toBeLessThanOrEqual(5 + 2.6); // the budget, plus the newest phrase being the one that tips it
  });

  it("ends a phrase that runs on without a break, and starts a new one", () => {
    const { rec, run } = setup({ maxPhraseSeconds: 3 });
    run(1000, 9000, () => true);
    expect(phrases(rec).length).toBeGreaterThanOrEqual(2);
    for (const u of phrases(rec)) expect(seconds(u)).toBeLessThan(3.6);
  });
});
