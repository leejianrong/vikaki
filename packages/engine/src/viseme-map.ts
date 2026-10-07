import type { VisemeWeights } from "./renderer.ts";

/** wLipSync names its phonemes by Japanese vowel letters; map them onto the VRM mouth shapes. */
const PHONEME_TO_VISEME = { A: "aa", I: "ih", U: "ou", E: "ee", O: "oh" } as const;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Turn wLipSync output into mouth shape weights. Each phoneme weight is scaled by the
 * overall volume, so quiet noise barely opens the mouth. Unknown phoneme keys are ignored.
 */
export function toVisemeWeights(phonemes: Record<string, number>, volume: number): VisemeWeights {
  const v = clamp01(volume);
  const out: VisemeWeights = {};
  for (const [key, viseme] of Object.entries(PHONEME_TO_VISEME)) {
    out[viseme] = clamp01((phonemes[key] ?? 0) * v);
  }
  return out;
}

/** The strongest mouth shape weight: a single "how open is the mouth" number. */
export function openness(w: VisemeWeights): number {
  return Math.max(0, ...Object.values(w).map((x) => x ?? 0));
}
