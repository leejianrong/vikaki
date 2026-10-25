// The phonemes of the lines being heard, with when each is spoken on the page's clock (VIK-50, ADR-0047). The hub sends them with the audio when
// started with `--phonemes`; this keeps them until they are past. Pure: it is given times, so a test needs no audio.
import type { WirePhoneme } from "./playback.ts";

/** A phoneme with its time on the page's `performance.now()` clock. */
export interface TimedPhoneme {
  utteranceId: string;
  /** IPA, with any length mark. */
  p: string;
  startMs: number;
  endMs: number;
  stress: 0 | 1 | 2;
}

export class PhonemeTrack {
  private items: TimedPhoneme[] = [];

  /** Add a slice's phonemes: `startPerfMs` is when the slice is heard. */
  add(utteranceId: string, startPerfMs: number, spans: readonly WirePhoneme[]): void {
    for (const s of spans) this.items.push({ utteranceId, p: s.p, startMs: startPerfMs + s.t, endMs: startPerfMs + s.t + s.d, stress: s.s ?? 0 });
    this.items.sort((a, b) => a.startMs - b.startMs);
  }

  /** The phoneme spoken at `perfMs`, if any. Between two sounds, or in a pause, there is none. */
  at(perfMs: number): TimedPhoneme | undefined {
    let lo = 0;
    let hi = this.items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const it = this.items[mid]!;
      if (perfMs < it.startMs) hi = mid - 1;
      else if (perfMs >= it.endMs) lo = mid + 1;
      else return it;
    }
    return undefined;
  }

  /** The next phoneme to start after `perfMs`, for easing toward it. */
  next(perfMs: number): TimedPhoneme | undefined {
    return this.items.find((i) => i.startMs > perfMs);
  }

  /** A line was cut off: its phonemes are no longer coming. */
  clear(utteranceId: string): void {
    this.items = this.items.filter((i) => i.utteranceId !== utteranceId);
  }

  /** Forget what is more than `keepMs` in the past. Call now and then; the track would otherwise grow with every line. */
  prune(nowMs: number, keepMs = 2000): void {
    if (this.items.length > 0 && this.items[0]!.endMs < nowMs - keepMs) this.items = this.items.filter((i) => i.endMs >= nowMs - keepMs);
  }

  get size(): number {
    return this.items.length;
  }

  /** Everything held, for tests and the debug API. */
  all(): readonly TimedPhoneme[] {
    return this.items;
  }
}
