// Which mouth shape a phoneme makes (VIK-51, ADR-0048). The avatar has five open shapes (the VRM vowels aa ih ou ee oh) and a closed mouth
// (all zero). A vowel picks its shape; a consonant is a quiet version of the shape its lips and tongue make, and the lips-together sounds close
// the mouth. These are targets: `PhonemeMouth` eases between them, so the shape of one sound leans into the next.
import type { VisemeWeights } from "./renderer.ts";

export interface MouthShape {
  /** Weights of the five shapes; empty is a closed mouth. */
  weights: VisemeWeights;
  /** How much a stressed or unstressed sound moves the mouth: the shape's weights are scaled by this and the sound's stress. */
  strength: number;
}

const CLOSED: MouthShape = { weights: {}, strength: 0 };

const VOWEL_SHAPES: Record<string, MouthShape> = {
  a: { weights: { aa: 1 }, strength: 1 },
  ɑ: { weights: { aa: 1 }, strength: 1 },
  ɐ: { weights: { aa: 0.55 }, strength: 0.6 },
  ʌ: { weights: { aa: 0.75 }, strength: 0.85 },
  æ: { weights: { aa: 0.8, ee: 0.3 }, strength: 1 },
  ɒ: { weights: { oh: 0.9, aa: 0.3 }, strength: 1 },
  ɔ: { weights: { oh: 1 }, strength: 0.95 },
  o: { weights: { oh: 1 }, strength: 0.95 },
  ø: { weights: { oh: 0.6, ee: 0.3 }, strength: 0.8 },
  œ: { weights: { oh: 0.6, ee: 0.4 }, strength: 0.8 },
  u: { weights: { ou: 1 }, strength: 0.85 },
  ʊ: { weights: { ou: 0.8 }, strength: 0.75 },
  ɯ: { weights: { ou: 0.6, ih: 0.3 }, strength: 0.7 },
  i: { weights: { ih: 1 }, strength: 0.7 },
  ɪ: { weights: { ih: 0.8 }, strength: 0.65 },
  y: { weights: { ou: 0.5, ih: 0.5 }, strength: 0.7 },
  e: { weights: { ee: 1 }, strength: 0.85 },
  ɛ: { weights: { ee: 1, aa: 0.2 }, strength: 0.9 },
  ɜ: { weights: { ee: 0.6, aa: 0.2 }, strength: 0.75 },
  ɝ: { weights: { ee: 0.5, ou: 0.3 }, strength: 0.75 },
  ə: { weights: { ee: 0.35, aa: 0.15 }, strength: 0.5 },
  ɚ: { weights: { ee: 0.3, ou: 0.25 }, strength: 0.5 },
};

const CONSONANT_SHAPES: Record<string, MouthShape> = {
  // lips together: the mouth shuts (a puff of the cheeks is not drawn)
  p: CLOSED,
  b: CLOSED,
  m: CLOSED,
  // lip on teeth: a slit
  f: { weights: { ih: 0.25 }, strength: 0.5 },
  v: { weights: { ih: 0.25 }, strength: 0.5 },
  // rounded lips
  w: { weights: { ou: 0.8 }, strength: 0.8 },
  ʃ: { weights: { ou: 0.45, ih: 0.15 }, strength: 0.6 },
  ʒ: { weights: { ou: 0.45, ih: 0.15 }, strength: 0.6 },
  // teeth close together, lips spread
  s: { weights: { ih: 0.3 }, strength: 0.5 },
  z: { weights: { ih: 0.3 }, strength: 0.5 },
  j: { weights: { ih: 0.5 }, strength: 0.6 },
  // tongue between the teeth
  θ: { weights: { ee: 0.3 }, strength: 0.5 },
  ð: { weights: { ee: 0.3 }, strength: 0.5 },
  // tongue sounds: the mouth is a little open and mostly follows its neighbours
  t: { weights: { ee: 0.2 }, strength: 0.4 },
  d: { weights: { ee: 0.2 }, strength: 0.4 },
  n: { weights: { ee: 0.2 }, strength: 0.4 },
  l: { weights: { ee: 0.25 }, strength: 0.45 },
  ɹ: { weights: { ou: 0.3, ee: 0.15 }, strength: 0.5 },
  r: { weights: { ou: 0.3, ee: 0.15 }, strength: 0.5 },
  ɾ: { weights: { ee: 0.2 }, strength: 0.4 },
  // back of the mouth
  k: { weights: { aa: 0.2 }, strength: 0.4 },
  ɡ: { weights: { aa: 0.2 }, strength: 0.4 },
  g: { weights: { aa: 0.2 }, strength: 0.4 },
  ŋ: { weights: { aa: 0.2 }, strength: 0.4 },
  h: { weights: { aa: 0.25 }, strength: 0.4 },
};

/** A shape for a sound that is none of the above: a small, neutral opening. */
const OTHER: MouthShape = { weights: { ee: 0.2 }, strength: 0.4 };

/** The shape of a phoneme (IPA, with any length or other marks after it). */
export function shapeOf(phoneme: string): MouthShape {
  const base = [...phoneme][0] ?? "";
  return VOWEL_SHAPES[base] ?? CONSONANT_SHAPES[base] ?? OTHER;
}

/**
 * The mouth weights a phoneme asks for. `articulation` (0 to 1, default 0.8) says how pronounced the mouth is: 1 opens every sound as wide as its shape
 * says, less keeps it quieter. A stressed sound is wider and an unstressed one narrower; a long vowel (the length mark) is held at full.
 */
export function weightsFor(phoneme: string, stress: 0 | 1 | 2, articulation = 0.8): VisemeWeights {
  const shape = shapeOf(phoneme);
  const emphasis = stress === 1 ? 1.15 : stress === 2 ? 1.0 : 0.85;
  const k = Math.min(1, shape.strength * emphasis * articulation * 1.25);
  const out: VisemeWeights = {};
  for (const [name, w] of Object.entries(shape.weights) as [keyof VisemeWeights, number][]) out[name] = Math.min(1, w * k);
  return out;
}

const ORDER = ["aa", "ih", "ou", "ee", "oh"] as const;

/** For a vowel, the index (in `aa ih ou ee oh`) of the shape it is mostly made with; undefined for any other sound. For the scorecard. */
export function vowelShape(phoneme: string): number | undefined {
  const shape = VOWEL_SHAPES[[...phoneme][0] ?? ""];
  if (!shape) return undefined;
  let best = 0;
  let bestWeight = -1;
  for (const [i, name] of ORDER.entries()) {
    const w = shape.weights[name] ?? 0;
    if (w > bestWeight) {
      best = i;
      bestWeight = w;
    }
  }
  return best;
}
