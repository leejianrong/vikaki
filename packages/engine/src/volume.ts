// Pure loudness maths, kept free of browser imports so it can be unit tested in Node.

// Same loudness window wLipSync uses: log10(RMS) from -2.5 (silence) to -1.5 (full).
const MIN_LOG = -2.5;
const MAX_LOG = -1.5;

/** Map a raw RMS level to [0, 1]. Quiet room noise maps to 0. */
export function rmsToVolume(rms: number): number {
  if (!(rms > 0)) return 0;
  return Math.min(1, Math.max(0, (Math.log10(rms) - MIN_LOG) / (MAX_LOG - MIN_LOG)));
}
