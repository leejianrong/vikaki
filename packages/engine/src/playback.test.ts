import { describe, expect, it } from "vitest";
import { Playback, type AudioSlice, type Output, type PlaybackEvents, type ScheduledSlice } from "./playback.ts";

/** A clock and a recorder standing in for Web Audio. */
class FakeOutput implements Output {
  time = 0;
  perfMs?: (t: number) => number;
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

describe("Playback: telling the timeline what was scheduled", () => {
  it("reports each slice with when it is heard on the page clock, and its sentence", () => {
    const out = new FakeOutput();
    out.perfMs = (t) => 5000 + t * 1000; // the page clock runs 5 s ahead of this output's
    const seen: ScheduledSlice[] = [];
    const pb = new Playback(() => out, { started() {}, finished() {}, interrupted() {} }, { lookahead: 5, lead: 0.5, scheduled: (s) => seen.push(s) });
    const slice = (seconds: number, extra: Partial<AudioSlice>): AudioSlice => ({ utteranceId: "a", samples: new Float32Array(seconds * 1000), sampleRate: 1000, final: false, ...extra });
    pb.push(slice(1, { sentenceIndex: 0, sentenceText: "Hello." }));
    pb.push(slice(2, { sentenceIndex: 1, sentenceText: "How are you?" }));
    pb.push(slice(1, { sentenceIndex: 1 }));
    expect(seen.map((s) => [s.utteranceId, s.sentenceIndex, s.sentenceText, s.startPerfMs])).toEqual([
      ["a", 0, "Hello.", 5500],
      ["a", 1, "How are you?", 6500],
      ["a", 1, undefined, 8500],
    ]);
    expect(seen[1]!.samples).toHaveLength(2000);
  });

  it("assumes the output clock in seconds when it cannot say", () => {
    const out = new FakeOutput();
    const seen: ScheduledSlice[] = [];
    const pb = new Playback(() => out, { started() {}, finished() {}, interrupted() {} }, { lead: 0.25, scheduled: (s) => seen.push(s) });
    pb.push({ utteranceId: "a", samples: new Float32Array(500), sampleRate: 1000, final: false });
    expect(seen[0]!.startPerfMs).toBe(250);
  });
});

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

describe("Playback when sound is allowed part-way through a line (the output's clock changes)", () => {
  /**
   * The page before sound is allowed counts on the page clock; Web Audio counts from when its context was made. In a real page the
   * two differ by that start offset (about a second); the test makes the gap huge (4000 s against 12 s) so a mix-up cannot hide.
   */
  function twoClocks() {
    const silent = new FakeOutput();
    silent.time = 4000;
    silent.perfMs = (t) => t * 1000;
    const web = new FakeOutput();
    web.time = 12;
    web.perfMs = (t) => 9_000_000 + (t - 12) * 1000; // where this output's times land on the page clock (a distinct base, so the two are told apart)
    let current: Output = silent;
    const log: string[] = [];
    const seen: ScheduledSlice[] = [];
    const pb = new Playback(() => current, { started: (id) => log.push(`started:${id}`), finished: (id) => log.push(`finished:${id}`), interrupted: (id, r) => log.push(`interrupted:${id}:${r}`) }, { lookahead: 0.4, lead: 0.03, scheduled: (s) => seen.push(s) });
    const slice = (seconds: number, final = false, id = "a"): AudioSlice => ({ utteranceId: id, samples: new Float32Array(Math.round(seconds * 1000)), sampleRate: 1000, final });
    return { silent, web, pb, log, seen, slice, switchToWeb: () => (current = web) };
  }

  it("still reports the line started and finished when the switch comes before its first audio was heard", () => {
    const { silent, web, pb, log, slice, switchToWeb } = twoClocks();
    pb.push(slice(0.2)); // scheduled on the page clock at 4000.03: not yet heard
    pb.push(slice(0.2, true));
    expect(log).toEqual([]);
    switchToWeb(); // sound is allowed now
    pb.tick();
    for (let t = 12; t <= 14; t += 0.05) {
      web.time = t;
      pb.tick();
    }
    expect(log, "started once, then finished").toEqual(["started:a", "finished:a"]);
    void silent;
  });

  it("schedules what is left on the new clock right away, with no wait for the old clock's time to come round", () => {
    const { web, pb, slice, switchToWeb } = twoClocks();
    pb.push(slice(1));
    pb.push(slice(1)); // the second slice waits: only 0.4 s is scheduled ahead
    switchToWeb();
    pb.tick();
    expect(web.played.length).toBeGreaterThan(0);
    expect(web.played[0]!.at).toBeCloseTo(12.03, 5); // now + lead on the new clock, not 4000-something
  });

  it("tells the timeline where slices heard after the switch are, on the page clock", () => {
    const { web, pb, seen, slice, switchToWeb } = twoClocks();
    pb.push(slice(0.3));
    switchToWeb();
    pb.push(slice(0.3, true));
    for (let t = 12; t <= 13; t += 0.05) {
      web.time = t;
      pb.tick();
    }
    const after = seen.filter((s) => s.startPerfMs > 8_000_000); // the new output's page-clock range
    expect(after.length).toBeGreaterThan(0);
    for (const s of after) expect(s.startPerfMs).toBeCloseTo(9_000_000 + 30, -1); // now + lead on the new clock, converted by the new output
  });

  it("a line whose first slice was scheduled on the old clock and whose last arrives after the switch still starts and finishes", () => {
    const { web, pb, log, slice, switchToWeb } = twoClocks();
    pb.push(slice(0.1));
    pb.tick();
    switchToWeb();
    pb.push(slice(0.1, true));
    for (let t = 12; t <= 13; t += 0.05) {
      web.time = t;
      pb.tick();
    }
    expect(log).toEqual(["started:a", "finished:a"]);
  });
});
