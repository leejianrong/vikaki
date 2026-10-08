import { describe, expect, it } from "vitest";
import { Playback, type AudioSlice, type Output, type PlaybackEvents } from "./playback.ts";

/** A clock and a recorder standing in for Web Audio. */
class FakeOutput implements Output {
  time = 0;
  readonly played: { at: number; seconds: number; stopped: boolean }[] = [];
  now() {
    return this.time;
  }
  play(samples: Float32Array, rate: number, at: number) {
    const rec = { at, seconds: samples.length / rate, stopped: false };
    this.played.push(rec);
    return { stop: () => (rec.stopped = true) };
  }
}

function setup(options?: { lookahead?: number; lead?: number }) {
  const out = new FakeOutput();
  const log: string[] = [];
  const events: PlaybackEvents = {
    started: (id) => log.push(`started:${id}`),
    finished: (id) => log.push(`finished:${id}`),
    interrupted: (id, reason) => log.push(`interrupted:${id}:${reason}`),
  };
  const pb = new Playback(() => out, events, options);
  const slice = (id: string, seconds: number, final = false): AudioSlice => ({
    utteranceId: id,
    samples: new Float32Array(Math.round(seconds * 1000)),
    sampleRate: 1000,
    final,
  });
  const advance = (to: number) => {
    out.time = to;
    pb.tick();
  };
  return { out, log, pb, slice, advance };
}

describe("Playback", () => {
  it("schedules slices back to back with no gap", () => {
    const { out, pb, slice, advance } = setup({ lookahead: 5 });
    pb.push(slice("a", 1));
    pb.push(slice("a", 1));
    pb.push(slice("a", 1, true));
    advance(0);
    const [s1, s2, s3] = out.played;
    expect(s2!.at).toBeCloseTo(s1!.at + 1, 6);
    expect(s3!.at).toBeCloseTo(s2!.at + 1, 6);
  });

  it("reports started when the first slice begins, and finished only after the end of a final slice", () => {
    const { log, pb, slice, advance } = setup({ lookahead: 5 });
    pb.push(slice("a", 1));
    pb.push(slice("a", 1, true));
    expect(log).toEqual([]); // scheduled 30 ms ahead, not yet started
    advance(0.05);
    expect(log).toEqual(["started:a"]);
    advance(1.5);
    expect(log).toEqual(["started:a"]);
    advance(2.1);
    expect(log).toEqual(["started:a", "finished:a"]);
  });

  it("does not finish without a final slice, however long it has been quiet", () => {
    const { log, pb, slice, advance } = setup();
    pb.push(slice("a", 0.2));
    advance(10);
    expect(log).toEqual(["started:a"]);
    pb.push(slice("a", 0, true));
    advance(10.1);
    expect(log).toEqual(["started:a", "finished:a"]);
  });

  it("schedules only a short way ahead, so a cancel leaves nothing queued", () => {
    const { out, pb, slice, advance } = setup({ lookahead: 0.4 });
    for (let i = 0; i < 10; i++) pb.push(slice("a", 1, i === 9));
    advance(0);
    expect(out.played).toHaveLength(1);
    advance(1);
    expect(out.played).toHaveLength(2);
  });

  it("cancelling mid-speech stops the audio, reports the interruption once, and starts the next utterance at once", () => {
    const { out, log, pb, slice, advance } = setup({ lookahead: 0.4 });
    pb.push(slice("a", 5, true));
    pb.push(slice("b", 1, true));
    advance(0.1);
    expect(log).toEqual(["started:a"]);
    advance(1);
    pb.cancel("a");
    expect(out.played[0]!.stopped).toBe(true);
    expect(log).toEqual(["started:a", "interrupted:a:cancelled"]);
    const b = out.played[1]!;
    expect(b.at).toBeCloseTo(1.03, 6); // right now plus the lead, not where a would have ended
    advance(1.1);
    expect(log).toContain("started:b");
    pb.cancel("a");
    expect(log.filter((l) => l.startsWith("interrupted"))).toHaveLength(1);
  });

  it("ignores audio that arrives after a cancel", () => {
    const { out, log, pb, slice, advance } = setup();
    pb.push(slice("a", 1));
    advance(0.1);
    pb.cancel("a");
    pb.push(slice("a", 1, true));
    advance(5);
    expect(pb.active).toEqual([]);
    expect(out.played).toHaveLength(1);
    expect(log).toEqual(["started:a", "interrupted:a:cancelled"]);
  });

  it("says nothing when cancelling something it never received or that already finished", () => {
    const { log, pb, slice, advance } = setup();
    pb.cancel("nope");
    pb.push(slice("a", 0.1, true));
    advance(1);
    pb.cancel("a");
    expect(log).toEqual(["started:a", "finished:a"]);
  });

  it("plays queued utterances in order, one at a time", () => {
    const { log, pb, slice, advance } = setup({ lookahead: 5 });
    pb.push(slice("a", 1, true));
    pb.push(slice("b", 1, true));
    advance(0.05);
    expect(log).toEqual(["started:a"]);
    advance(1.2);
    expect(log).toEqual(["started:a", "finished:a"]); // b is scheduled 30 ms ahead, so not started yet
    advance(1.3);
    expect(log).toEqual(["started:a", "finished:a", "started:b"]);
    advance(2.5);
    expect(log.at(-1)).toBe("finished:b");
  });

  it("reports an utterance with no audio as started and finished at once", () => {
    const { log, pb, slice } = setup();
    pb.push(slice("a", 0, true));
    expect(log).toEqual(["started:a", "finished:a"]);
  });

  it("can interrupt everything for a human talking over the avatar", () => {
    const { log, pb, slice, advance } = setup();
    pb.push(slice("a", 3, true));
    pb.push(slice("b", 3, true));
    advance(0.1);
    pb.cancelAll();
    expect(log).toEqual(["started:a", "interrupted:a:human_spoke", "interrupted:b:human_spoke"]);
    expect(pb.active).toEqual([]);
  });

  it("starts afresh when the output (and so its clock) changes", () => {
    const first = new FakeOutput();
    const second = new FakeOutput();
    second.time = 1000; // a very different clock
    let current: Output = first;
    const log: string[] = [];
    const pb = new Playback(() => current, { started: (id) => log.push(`started:${id}`), finished: () => {}, interrupted: () => {} });
    pb.push({ utteranceId: "a", samples: new Float32Array(1000), sampleRate: 1000, final: false });
    current = second;
    pb.push({ utteranceId: "a", samples: new Float32Array(1000), sampleRate: 1000, final: true });
    expect(second.played[0]!.at).toBeCloseTo(1000.03, 6);
  });
});
