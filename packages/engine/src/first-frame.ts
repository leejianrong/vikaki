/** Mouth weights summing to less than this count as closed. */
export const MOUTH_OPEN = 0.05;

export interface SpeechTimingReport {
  /** From the page receiving the line to its first sound being heard, in ms. */
  audio_ms: number;
  /** From the page receiving the line to the first rendered frame with the mouth open, in ms. Absent if the line ended before one. */
  frame_ms?: number;
}

interface Mark {
  received: number;
  heard?: number;
  frame?: number;
}

/**
 * Times what a viewer can see for itself: when a line arrived, when it was heard, and when the first frame
 * of the avatar speaking was drawn. One clock (the page's), so it needs no agreement with the server.
 */
export class FirstFrameTimer {
  private readonly marks = new Map<string, Mark>();

  /** The line reached the page. Only the first call per id counts. */
  received(id: string, t: number): void {
    if (!this.marks.has(id)) this.marks.set(id, { received: t });
  }

  heard(id: string, t: number): void {
    const m = this.marks.get(id);
    if (m && m.heard === undefined) m.heard = t;
  }

  /** Call once per rendered frame with the mouth weights as drawn. */
  frame(t: number, mouthSum: number): void {
    if (mouthSum < MOUTH_OPEN) return;
    for (const m of this.marks.values()) if (m.heard !== undefined && m.frame === undefined) m.frame = t;
  }

  /** The timing of a line that has ended, and forget it. Undefined if it was never heard. */
  take(id: string): SpeechTimingReport | undefined {
    const m = this.marks.get(id);
    this.marks.delete(id);
    if (!m || m.heard === undefined) return undefined;
    const round = (n: number) => Math.round(n);
    return { audio_ms: round(m.heard - m.received), ...(m.frame !== undefined ? { frame_ms: round(m.frame - m.received) } : {}) };
  }
}
