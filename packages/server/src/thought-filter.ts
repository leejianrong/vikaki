/**
 * The sound of thinking aloud (VIK-121): a line passed through this is softer, duller and a little echoey, so a listener hears at once that it is
 * not said to the table. It works on a stream, piece by piece, and keeps its state between pieces so there is no click at a seam.
 */
export class ThoughtFilter {
  /** How loud a thought is, against the same line said aloud. */
  static readonly GAIN = 0.55;
  /** Above this (Hz) the voice is rolled off: a muffled, inside-the-head sound. */
  static readonly CUTOFF_HZ = 2200;
  private low = 0;
  private echo = new Float32Array(0);
  private at = 0;

  process(samples: Float32Array, sampleRate: number): Float32Array {
    if (this.echo.length === 0) this.echo = new Float32Array(Math.round(sampleRate * 0.085));
    const a = 1 - Math.exp((-2 * Math.PI * ThoughtFilter.CUTOFF_HZ) / sampleRate);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      this.low += a * (samples[i]! - this.low);
      const wet = this.echo[this.at]!;
      const y = this.low + 0.3 * wet;
      this.echo[this.at] = y;
      this.at = (this.at + 1) % this.echo.length;
      out[i] = Math.max(-1, Math.min(1, y * ThoughtFilter.GAIN));
    }
    return out;
  }
}
