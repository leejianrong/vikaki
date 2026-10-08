import { encodePcm16 } from "@vikaki/protocol";
import type { VisemeWeights } from "./renderer.ts";

/** The five mouth shapes, in the order they are stored. */
export const MOUTH_SHAPES = ["aa", "ih", "ou", "ee", "oh"] as const;
/** Per frame: 5 commanded weights, 5 applied weights, volume, blink. */
export const FRAME_FIELDS = MOUTH_SHAPES.length * 2 + 2;

export interface TimelineEvent {
  /** Milliseconds since the recorder started. */
  t: number;
  kind: string;
  utteranceId?: string;
  detail?: string;
}

/** One spoken piece of an utterance (a sentence, or a clause of a long one) and when it was heard. */
export interface Piece {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface AudioPlacement {
  startMs: number;
  sampleRate: number;
  samples: Float32Array;
}

export interface UtteranceTimeline {
  id: string;
  startMs: number;
  endMs: number;
  /** Set when playback was cut short; nothing after this was heard. */
  interruptedAtMs?: number;
  pieces: Piece[];
  audio: AudioPlacement[];
}

/** A copy of the recorded frames in a time range, oldest first. Frame `i` is `data[i * FRAME_FIELDS ...]`. */
export interface FrameRange {
  count: number;
  t: Float64Array;
  data: Float32Array;
}

export interface TimelineOptions {
  /** Milliseconds, like `performance.now()`. Injected so tests control time. */
  now?: () => number;
  /** How many frames to keep (60 fps for 10 minutes by default). */
  maxFrames?: number;
  maxUtterances?: number;
  maxEvents?: number;
}

const durationMs = (a: AudioPlacement) => (a.samples.length / a.sampleRate) * 1000;

/**
 * Remembers what the page did, on one clock, so it can be looked at afterwards: every frame's mouth (as commanded
 * and as displayed), the speech events, and where each piece of speech and its audio fell in time. Pure data, no DOM.
 */
export class TimelineRecorder {
  private readonly clock: () => number;
  private readonly origin: number;
  private readonly cap: number;
  private readonly times: Float64Array;
  private readonly values: Float32Array;
  private first = 0;
  private size = 0;
  private readonly eventList: TimelineEvent[] = [];
  private readonly byId = new Map<string, UtteranceTimeline>();
  private readonly maxUtterances: number;
  private readonly maxEvents: number;

  constructor(o: TimelineOptions = {}) {
    this.clock = o.now ?? (() => performance.now());
    this.origin = this.clock();
    this.cap = Math.max(1, o.maxFrames ?? 36_000);
    this.times = new Float64Array(this.cap);
    this.values = new Float32Array(this.cap * FRAME_FIELDS);
    this.maxUtterances = o.maxUtterances ?? 30;
    this.maxEvents = o.maxEvents ?? 5000;
  }

  /** Milliseconds since the recorder started. */
  now(): number {
    return this.clock() - this.origin;
  }

  /** Convert a `performance.now()` reading (or any reading of the injected clock) to timeline milliseconds. */
  fromPerfMs(perfMs: number): number {
    return perfMs - this.origin;
  }

  get frameCount(): number {
    return this.size;
  }

  /** Record one rendered frame. */
  frame(commanded: VisemeWeights, applied: VisemeWeights, volume: number, blink: number): void {
    const slot = (this.first + this.size) % this.cap;
    if (this.size === this.cap) this.first = (this.first + 1) % this.cap;
    else this.size++;
    this.times[slot] = this.now();
    const base = slot * FRAME_FIELDS;
    MOUTH_SHAPES.forEach((shape, i) => {
      this.values[base + i] = commanded[shape] ?? 0;
      this.values[base + MOUTH_SHAPES.length + i] = applied[shape] ?? 0;
    });
    this.values[base + FRAME_FIELDS - 2] = volume;
    this.values[base + FRAME_FIELDS - 1] = blink;
  }

  /** Frames with `fromMs <= t <= toMs`, oldest first. */
  frames(fromMs = -Infinity, toMs = Infinity): FrameRange {
    const t: number[] = [];
    const rows: number[] = [];
    for (let i = 0; i < this.size; i++) {
      const slot = (this.first + i) % this.cap;
      const time = this.times[slot]!;
      if (time < fromMs || time > toMs) continue;
      t.push(time);
      rows.push(slot);
    }
    const data = new Float32Array(rows.length * FRAME_FIELDS);
    rows.forEach((slot, i) => data.set(this.values.subarray(slot * FRAME_FIELDS, (slot + 1) * FRAME_FIELDS), i * FRAME_FIELDS));
    return { count: rows.length, t: Float64Array.from(t), data };
  }

  /** Record something that happened: "started", "finished", "interrupted", "sent", "blink"... */
  event(kind: string, utteranceId?: string, detail?: string): void {
    const t = this.now();
    this.eventList.push({ t, kind, ...(utteranceId !== undefined ? { utteranceId } : {}), ...(detail !== undefined ? { detail } : {}) });
    if (this.eventList.length > this.maxEvents) this.eventList.shift();
    if (kind === "interrupted" && utteranceId !== undefined) this.cut(utteranceId, t);
  }

  events(): readonly TimelineEvent[] {
    return this.eventList;
  }

  /** A slice of audio was handed to the speakers; it will be heard from `startPerfMs`. */
  scheduled(s: { utteranceId: string; sentenceIndex?: number; sentenceText?: string; startPerfMs: number; samples: Float32Array; sampleRate: number }): void {
    const startMs = this.fromPerfMs(s.startPerfMs);
    const place: AudioPlacement = { startMs, sampleRate: s.sampleRate, samples: s.samples };
    const endMs = startMs + durationMs(place);
    let u = this.byId.get(s.utteranceId);
    if (!u) {
      u = { id: s.utteranceId, startMs, endMs, pieces: [], audio: [] };
      this.byId.set(u.id, u);
      while (this.byId.size > this.maxUtterances) this.byId.delete(this.byId.keys().next().value as string);
    }
    u.audio.push(place);
    u.startMs = Math.min(u.startMs, startMs);
    u.endMs = Math.max(u.endMs, endMs);
    const index = s.sentenceIndex ?? 0;
    let piece = u.pieces.find((p) => p.index === index);
    if (!piece) {
      piece = { index, text: "", startMs, endMs };
      u.pieces.push(piece);
      u.pieces.sort((a, b) => a.index - b.index);
    }
    if (s.sentenceText !== undefined) piece.text = s.sentenceText;
    piece.startMs = Math.min(piece.startMs, startMs);
    piece.endMs = Math.max(piece.endMs, endMs);
  }

  utterance(id: string): UtteranceTimeline | undefined {
    return this.byId.get(id);
  }

  /** Oldest first. */
  utterances(): UtteranceTimeline[] {
    return [...this.byId.values()];
  }

  /** Playback stopped at `t`: whatever was scheduled after it was never heard. */
  private cut(id: string, t: number): void {
    const u = this.byId.get(id);
    if (!u) return;
    u.interruptedAtMs = t;
    u.pieces = u.pieces.filter((p) => p.startMs < t);
    for (const p of u.pieces) p.endMs = Math.min(p.endMs, t);
    u.audio = u.audio.filter((a) => a.startMs < t);
    for (const a of u.audio) {
      const heard = Math.max(0, Math.floor(((t - a.startMs) / 1000) * a.sampleRate));
      if (heard < a.samples.length) a.samples = a.samples.subarray(0, heard);
    }
    u.endMs = Math.min(u.endMs, t);
  }

  /** Everything in `[fromMs, toMs]` as plain JSON. Audio is included as base64 16-bit PCM only when asked. */
  toJSON(range: { fromMs?: number; toMs?: number; includeAudio?: boolean } = {}) {
    const from = range.fromMs ?? -Infinity;
    const to = range.toMs ?? Infinity;
    const f = this.frames(from, to);
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      version: 1,
      shapes: [...MOUTH_SHAPES],
      /** Per frame: t, then the commanded weights, the applied weights, volume and blink. */
      frames: Array.from({ length: f.count }, (_, i) => [round(f.t[i]!), ...Array.from(f.data.subarray(i * FRAME_FIELDS, (i + 1) * FRAME_FIELDS), round)]),
      events: this.eventList.filter((e) => e.t >= from && e.t <= to),
      utterances: this.utterances()
        .filter((u) => u.endMs >= from && u.startMs <= to)
        .map((u) => ({
          id: u.id,
          startMs: round(u.startMs),
          endMs: round(u.endMs),
          ...(u.interruptedAtMs !== undefined ? { interruptedAtMs: round(u.interruptedAtMs) } : {}),
          pieces: u.pieces.map((p) => ({ ...p, startMs: round(p.startMs), endMs: round(p.endMs) })),
          audio: u.audio.map((a) => ({ startMs: round(a.startMs), sampleRate: a.sampleRate, seconds: round(a.samples.length / a.sampleRate), ...(range.includeAudio ? { pcm: encodePcm16(a.samples) } : {}) })),
        })),
    };
  }
}
