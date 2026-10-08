import { stft } from "./spectrogram.ts";

export interface Pause {
  startSec: number;
  endSec: number;
}

export interface SpeechMetrics {
  durationSec: number;
  sampleRate: number;
  peak: number;
  /** Share of samples at or beyond full scale. */
  clippedRatio: number;
  /** Share of the audio that is louder than the quiet floor. */
  activeRatio: number;
  /** Standard deviation of loudness divided by its mean, over the active frames. A steady tone is near 0.06; speech about 0.5. */
  loudnessVariation: number;
  /** Standard deviation, in Hz, of the spectral centroid over the active frames. A steady tone is under 10; speech over 1,000. */
  spectralWanderHz: number;
  /** Quiet gaps inside the audio, at least `MIN_PAUSE_SEC` long. Leading and trailing silence is not a pause. */
  pauses: Pause[];
  longestPauseSec: number;
}

export const MIN_PAUSE_SEC = 0.15;
/** A frame is "active" when it is within this many dB of the loud end (95th percentile) of the clip. */
const ACTIVE_DB = 30;
const SILENT_RMS = 1e-4;

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;
}

/** Numbers that tell speech from a buzz: how much loudness and timbre move, and where the pauses are. */
export function analyse(samples: Float32Array, sampleRate: number): SpeechMetrics {
  const durationSec = samples.length / sampleRate;
  let peak = 0;
  let clipped = 0;
  for (const v of samples) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
  }
  const s = stft(samples, sampleRate, 512, Math.round(sampleRate * 0.01));
  const empty: SpeechMetrics = {
    durationSec,
    sampleRate,
    peak,
    clippedRatio: samples.length ? clipped / samples.length : 0,
    activeRatio: 0,
    loudnessVariation: 0,
    spectralWanderHz: 0,
    pauses: [],
    longestPauseSec: 0,
  };
  if (s.frames === 0) return empty;

  const loud = percentile([...s.rms].sort((a, b) => a - b), 0.95);
  const floor = Math.max(SILENT_RMS, loud * 10 ** (-ACTIVE_DB / 20));
  const active = Array.from(s.rms, (r) => r > floor);
  const idx = active.flatMap((a, i) => (a ? [i] : []));
  if (idx.length === 0 || loud <= SILENT_RMS) return empty;

  const rms = idx.map((i) => s.rms[i]!);
  const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
  const loudnessVariation = Math.sqrt(rms.reduce((a, b) => a + (b - mean) ** 2, 0) / rms.length) / mean;

  const centroid = idx.map((i) => {
    let num = 0;
    let den = 0;
    for (let k = 0; k < s.bins; k++) {
      const m = s.mag[i * s.bins + k]!;
      num += m * k * s.binHz;
      den += m;
    }
    return den > 0 ? num / den : 0;
  });
  const cMean = centroid.reduce((a, b) => a + b, 0) / centroid.length;
  const spectralWanderHz = Math.sqrt(centroid.reduce((a, b) => a + (b - cMean) ** 2, 0) / centroid.length);

  const pauses: Pause[] = [];
  const first = idx[0]!;
  const last = idx[idx.length - 1]!;
  for (let i = first; i <= last; ) {
    if (active[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < active.length && !active[j]) j++;
    const startSec = (i * s.hopSec) + s.windowSec / 2;
    const endSec = (j * s.hopSec) + s.windowSec / 2;
    if (endSec - startSec >= MIN_PAUSE_SEC) pauses.push({ startSec: round(startSec), endSec: round(endSec) });
    i = j;
  }
  return {
    ...empty,
    activeRatio: idx.length / s.frames,
    loudnessVariation,
    spectralWanderHz,
    pauses,
    longestPauseSec: pauses.reduce((m, p) => Math.max(m, p.endSec - p.startSec), 0),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export type Verdict = "speech" | "buzz" | "silence";

/** Cut-offs sit between the measured speech and tone values (calibrated in docs/observability.md). */
export const GATE = { minLoudnessVariation: 0.2, minSpectralWanderHz: 300 };

export function classify(m: SpeechMetrics): { verdict: Verdict; reasons: string[] } {
  if (m.activeRatio === 0) return { verdict: "silence", reasons: ["nothing louder than the quiet floor"] };
  const reasons: string[] = [];
  if (m.loudnessVariation < GATE.minLoudnessVariation) reasons.push(`loudness barely moves (${m.loudnessVariation.toFixed(2)} < ${GATE.minLoudnessVariation})`);
  if (m.spectralWanderHz < GATE.minSpectralWanderHz) reasons.push(`timbre barely moves (${Math.round(m.spectralWanderHz)} Hz < ${GATE.minSpectralWanderHz} Hz)`);
  return reasons.length ? { verdict: "buzz", reasons } : { verdict: "speech", reasons: [] };
}
