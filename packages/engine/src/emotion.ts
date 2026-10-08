import { normaliseEmotion, type Emotion } from "@vikaki/protocol";
import { VISEMES, type VisemeWeights } from "./renderer.ts";

/** Manga-style marks drawn near the head. The face cannot frown or widen its eyes, so these carry the feeling (ADR-0015). */
export type SymbolKind = "sparkle" | "gleam" | "sweat" | "bang" | "gloom" | "anger" | "dots";

/**
 * How an emotion shows on an avatar whose face only has mouth shapes and blink. Every number is the amount at
 * full intensity; `poseFor` scales them linearly. Angles are radians; positive pitch nods down, positive roll tilts the
 * head toward the avatar's right ear.
 */
export interface EmotionPose {
  /** Eyelid closure held while not blinking, 0 to 1. Half-closed lids read as happy, smug, tired or cross. */
  squint: number;
  pitch: number;
  roll: number;
  yaw: number;
  /** Amplitude of a fast tremble of the head, 0 to 1. */
  shake: number;
  /** Amplitude of a gentle bounce, 0 to 1. */
  bob: number;
  /** Mouth shapes held while the mouth is not speaking (lip sync wins when it asks for more). */
  rest: VisemeWeights;
  symbol: SymbolKind | null;
  /** How visible the symbol is, 0 to 1. */
  symbolAmount: number;
}

export const NEUTRAL_POSE: EmotionPose = { squint: 0, pitch: 0, roll: 0, yaw: 0, shake: 0, bob: 0, rest: {}, symbol: null, symbolAmount: 0 };

type Preset = Omit<EmotionPose, "symbolAmount">;

export const EMOTION_PRESETS: Record<Emotion, Preset> = {
  neutral: { ...NEUTRAL_POSE },
  happy: { squint: 0.5, pitch: 0, roll: 0.07, yaw: 0, shake: 0, bob: 0.6, rest: { ee: 0.45 }, symbol: "sparkle" },
  smug: { squint: 0.4, pitch: -0.07, roll: -0.09, yaw: 0.04, shake: 0, bob: 0, rest: { ee: 0.25 }, symbol: "gleam" },
  worried: { squint: 0.1, pitch: 0.03, roll: 0.1, yaw: 0, shake: 0.35, bob: 0, rest: { ou: 0.15 }, symbol: "sweat" },
  surprised: { squint: 0, pitch: -0.06, roll: 0, yaw: 0, shake: 0, bob: 0, rest: { oh: 0.5 }, symbol: "bang" },
  sad: { squint: 0.3, pitch: 0.14, roll: 0.05, yaw: 0, shake: 0, bob: 0, rest: { ou: 0.3 }, symbol: "gloom" },
  angry: { squint: 0.3, pitch: 0.08, roll: 0, yaw: 0, shake: 0.5, bob: 0, rest: { ih: 0.3 }, symbol: "anger" },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The pose for an emotion at an intensity: linear from neutral, intensity clamped to [0, 1]. A missing or unusable intensity means full; an unknown emotion is neutral. */
export function poseFor(emotion: string | undefined, intensity = 1): EmotionPose {
  const k = Number.isFinite(intensity) ? clamp01(intensity) : 1;
  const p = EMOTION_PRESETS[normaliseEmotion(emotion)];
  if (k === 0 || p.symbol === null) return { ...NEUTRAL_POSE };
  const rest: VisemeWeights = {};
  for (const v of VISEMES) if (p.rest[v]) rest[v] = p.rest[v]! * k;
  return { squint: p.squint * k, pitch: p.pitch * k, roll: p.roll * k, yaw: p.yaw * k, shake: p.shake * k, bob: p.bob * k, rest, symbol: p.symbol, symbolAmount: k };
}

/** Time constant of the easing between poses. */
const TAU = 0.18;
/** Symbols fade faster than the face moves, so a new mark is up within a second even when an old one has to go first. */
const SYMBOL_TAU = 0.08;
/** Within 1% of the target after this long. */
export const SETTLE_SECONDS = 4.6 * TAU;

const NUMBERS = ["squint", "pitch", "roll", "yaw", "shake", "bob"] as const;

/**
 * The emotion on show: eases toward the target pose, frame-rate independent, and can be told to go back to
 * neutral after a while (a line ends; the face lingers for a moment, then relaxes).
 */
export class EmotionState {
  emotion: Emotion = "neutral";
  intensity = 0;
  private target: EmotionPose = { ...NEUTRAL_POSE };
  private current: EmotionPose = { ...NEUTRAL_POSE, rest: {} };
  private releaseIn: number | null = null;

  get pose(): EmotionPose {
    return this.current;
  }

  set(emotion: string | undefined, intensity = 1): void {
    this.emotion = normaliseEmotion(emotion);
    this.intensity = this.emotion === "neutral" ? 0 : Number.isFinite(intensity) ? clamp01(intensity) : 1;
    this.target = poseFor(emotion, intensity);
    this.releaseIn = null;
  }

  /** Go back to neutral after `seconds`. A later `set` cancels it. */
  release(seconds: number): void {
    this.releaseIn = Math.max(0, seconds);
  }

  update(dt: number): EmotionPose {
    if (this.releaseIn !== null) {
      this.releaseIn -= dt;
      if (this.releaseIn <= 0) {
        this.set("neutral");
      }
    }
    const a = 1 - Math.exp(-Math.max(0, dt) / TAU);
    const c = this.current;
    const t = this.target;
    const next: EmotionPose = { ...c, rest: { ...c.rest } };
    for (const k of NUMBERS) next[k] = c[k] + (t[k] - c[k]) * a;
    for (const v of VISEMES) {
      const now = c.rest[v] ?? 0;
      const to = t.rest[v] ?? 0;
      const value = now + (to - now) * a;
      if (value > 1e-4) next.rest[v] = value;
      else delete next.rest[v];
    }
    // A symbol fades out before another takes its place.
    const wanted = t.symbol;
    const b = 1 - Math.exp(-Math.max(0, dt) / SYMBOL_TAU);
    if (c.symbol !== null && c.symbol !== wanted) {
      next.symbolAmount = c.symbolAmount * (1 - b);
      if (next.symbolAmount < 0.05) {
        next.symbolAmount = 0;
        next.symbol = wanted;
      }
    } else {
      next.symbol = c.symbol ?? wanted;
      next.symbolAmount = c.symbolAmount + (t.symbolAmount - c.symbolAmount) * b;
      if (wanted === null && next.symbolAmount < 0.02) {
        next.symbolAmount = 0;
        next.symbol = null;
      }
    }
    this.current = next;
    return next;
  }
}
