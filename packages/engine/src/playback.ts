/** Where audio goes. The web page uses Web Audio; tests use a fake with a clock they control. */
export interface Output {
  /** Seconds on this output's own clock. */
  now(): number;
  /** Play `samples` starting at time `at` on that clock. */
  play(samples: Float32Array, sampleRate: number, at: number): { stop(): void };
  /** `performance.now()` in milliseconds when output-clock time `t` is heard, if this output can tell. Otherwise `t * 1000` is assumed. */
  perfMs?(t: number): number;
}

/** One slice handed to the output, with where in time it will be heard. For the timeline. */
export interface ScheduledSlice {
  utteranceId: string;
  sentenceIndex?: number;
  sentenceText?: string;
  /** When it starts being heard, in `performance.now()` milliseconds. */
  startPerfMs: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface PlaybackEvents {
  started(utteranceId: string, seatId?: string): void;
  finished(utteranceId: string): void;
  interrupted(utteranceId: string, reason: "cancelled" | "human_spoke"): void;
}

export interface AudioSlice {
  utteranceId: string;
  seatId?: string;
  samples: Float32Array;
  sampleRate: number;
  final: boolean;
  /** Which spoken piece of the utterance this slice is from, and that piece's text (first slice of the piece only). */
  sentenceIndex?: number;
  sentenceText?: string;
}

interface Entry {
  id: string;
  seatId?: string;
  pending: { samples: Float32Array; rate: number; sentenceIndex?: number; sentenceText?: string }[];
  final: boolean;
  handles: { stop(): void }[];
  firstStart?: number;
  reportedStart: boolean;
}

const TOMBSTONES = 200;

/**
 * Plays speech one utterance at a time and reports when each starts, finishes or is interrupted.
 *
 * Audio is scheduled a short way ahead rather than all at once, so cancelling an utterance leaves
 * no silent gap before the next one. Call `tick()` often (every 30 ms or so).
 */
export class Playback {
  private readonly queue: Entry[] = [];
  private readonly dead = new Set<string>();
  private cursor = 0; // end time of what is scheduled, on the output's clock
  private lastOutput?: Output;

  constructor(
    private readonly output: () => Output,
    private readonly events: PlaybackEvents,
    private readonly options: { lookahead?: number; lead?: number; scheduled?: (slice: ScheduledSlice) => void } = {},
  ) {}

  /** Utterances waiting or playing, in order. */
  get active(): string[] {
    return this.queue.map((e) => e.id);
  }

  push(slice: AudioSlice): void {
    if (this.dead.has(slice.utteranceId)) return; // late audio for something already cancelled
    let e = this.queue.find((q) => q.id === slice.utteranceId);
    if (!e) {
      e = { id: slice.utteranceId, seatId: slice.seatId, pending: [], final: false, handles: [], reportedStart: false };
      this.queue.push(e);
    }
    if (slice.samples.length > 0) e.pending.push({ samples: slice.samples, rate: slice.sampleRate, sentenceIndex: slice.sentenceIndex, sentenceText: slice.sentenceText });
    if (slice.final) e.final = true;
    this.tick();
  }

  cancel(utteranceId: string, reason: "cancelled" | "human_spoke" = "cancelled"): void {
    const i = this.queue.findIndex((e) => e.id === utteranceId);
    if (i < 0) return; // never started or already finished: nothing to interrupt
    const [e] = this.queue.splice(i, 1);
    for (const h of e!.handles) h.stop();
    this.dead.add(utteranceId);
    if (this.dead.size > TOMBSTONES) this.dead.delete(this.dead.values().next().value as string);
    if (i === 0) this.cursor = 0; // the next utterance starts right away, with no gap
    this.events.interrupted(utteranceId, reason);
    this.tick();
  }

  /** Stop everything (a human started talking over the avatar). */
  cancelAll(reason: "cancelled" | "human_spoke" = "human_spoke"): void {
    for (const id of this.active) this.cancel(id, reason);
  }

  tick(): void {
    const out = this.output();
    if (out !== this.lastOutput) {
      this.lastOutput = out;
      this.cursor = 0; // a different clock: schedule afresh
    }
    const lookahead = this.options.lookahead ?? 0.4;
    const lead = this.options.lead ?? 0.03;
    for (;;) {
      const head = this.queue[0];
      if (!head) return;
      const now = out.now();

      while (head.pending.length > 0 && this.cursor < now + lookahead) {
        const slice = head.pending.shift()!;
        const start = Math.max(this.cursor, now + lead);
        head.handles.push(out.play(slice.samples, slice.rate, start));
        this.options.scheduled?.({
          utteranceId: head.id,
          sentenceIndex: slice.sentenceIndex,
          sentenceText: slice.sentenceText,
          startPerfMs: out.perfMs ? out.perfMs(start) : start * 1000,
          samples: slice.samples,
          sampleRate: slice.rate,
        });
        head.firstStart ??= start;
        this.cursor = start + slice.samples.length / slice.rate;
      }

      if (!head.reportedStart) {
        // An utterance with no audio at all is reported as played straight away.
        if (head.firstStart === undefined ? head.final : now >= head.firstStart) {
          head.reportedStart = true;
          this.events.started(head.id, head.seatId);
        }
      }

      const allPlayed = head.final && head.pending.length === 0 && (head.firstStart === undefined || now >= this.cursor);
      if (head.reportedStart && allPlayed) {
        this.queue.shift();
        this.events.finished(head.id);
        continue; // the next utterance may be ready to start in the same tick
      }
      return;
    }
  }
}
