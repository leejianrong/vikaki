// A mouth driven by the phonemes the voice spoke (VIK-51, ADR-0048). It wraps the audio-driven mouth, so there is always something to fall back
// on, and it has two modes. `phoneme`: the shape and timing come from the phoneme track, eased between sounds; the audio only decides when there
// is nothing to follow. `hybrid`: the shape comes from the track and how far it opens follows the loudness of the audio, so a quiet syllable opens less.
import type { MouthDriver } from "./mouth.ts";
import type { PhonemeTrack } from "./phoneme-track.ts";
import { weightsFor } from "./phoneme-visemes.ts";
import type { VisemeWeights } from "./renderer.ts";

export type MouthMode = "audio" | "phoneme" | "hybrid";

/** The mouth a page has when `?mouth=` does not say: chosen by the scorecard comparison (docs/observability.md, ADR-0048). */
export const DEFAULT_MOUTH_MODE: MouthMode = "hybrid";

/** How pronounced the phoneme mouth is (`?articulation=`, 0 to 1) and how far it runs ahead of the sound, in ms (`?lead=`). Set by the scorecard comparison. */
export const DEFAULT_ARTICULATION = 0.8;
export const DEFAULT_LEAD = 60;

/** `?mouth=` as a mode; anything else is the default. */
export function parseMouthMode(value: string | null | undefined, fallback: MouthMode): MouthMode {
  return value === "audio" || value === "phoneme" || value === "hybrid" ? value : fallback;
}

/** How close a phoneme must be for a gap to count as a pause inside a line that has phonemes, in milliseconds. */
const NEAR_MS = 400;

/** In hybrid, the share of the shape's opening kept in silence-level volume, and how fast it grows with loudness. */
const HYBRID_FLOOR = 0.35;
const HYBRID_SLOPE = 0.9;

const SHAPES = ["aa", "ih", "ou", "ee", "oh"] as const;

export interface PhonemeMouthOptions {
  mode: Exclude<MouthMode, "audio">;
  /** How pronounced the mouth is, 0 to 1. */
  articulation?: number;
  /** Seconds the mouth runs ahead of where the track says a sound is: a mouth shapes the sound a little before it is heard. */
  lead?: number;
  /** Time constant of the easing toward a new shape, in seconds: smaller is snappier. */
  opening?: number;
  closing?: number;
  /** The page's clock in milliseconds; tests give their own. */
  clock?: () => number;
}

export class PhonemeMouth implements MouthDriver {
  private readonly o: Required<Omit<PhonemeMouthOptions, "clock">>;
  private readonly clock: () => number;
  private state: Record<(typeof SHAPES)[number], number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  private last = 0;
  private gate = 1;
  private cached: VisemeWeights = {};

  constructor(
    private readonly inner: MouthDriver,
    private readonly track: PhonemeTrack,
    options: PhonemeMouthOptions,
  ) {
    this.o = { articulation: DEFAULT_ARTICULATION, lead: DEFAULT_LEAD / 1000, opening: 0.035, closing: 0.05, ...options };
    this.clock = options.clock ?? (() => performance.now());
  }

  connect(source: AudioNode): void {
    this.inner.connect(source);
  }

  mute(): void {
    this.gate = 0;
    this.state = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    this.cached = {};
    this.inner.mute();
  }

  unmute(): void {
    this.gate = 1;
    this.inner.unmute();
  }

  get volume(): number {
    return this.inner.volume;
  }

  get weights(): VisemeWeights {
    const now = this.clock();
    if (now - this.last < 8 && this.last !== 0) return this.cached; // several reads in one frame give one answer
    const dt = this.last === 0 ? 0.016 : Math.min(0.05, Math.max(0, (now - this.last) / 1000)); // a first read, or one after the page stalled, moves one ordinary step
    this.last = now;
    const at = this.track.at(now + this.o.lead * 1000);
    if (!at) {
      // Between two sounds, or in a pause of a line that has phonemes, the mouth closes. When no phoneme is near (a line the hub sent none for, or
      // between lines) the audio mouth is the only thing to follow, so it is used: the mouth never freezes and never depends on the phonemes being there.
      if (!this.track.near(now, NEAR_MS)) return (this.cached = this.inner.weights);
      return (this.cached = this.ease({}, dt, 1));
    }
    const target = weightsFor(at.p, at.stress, this.o.articulation);
    // Hybrid: how far it opens follows how loud the voice is now (a floor so a quiet syllable still shows), but never wider than the sound's shape.
    const loud = this.o.mode === "hybrid" ? Math.min(1, HYBRID_FLOOR + HYBRID_SLOPE * this.inner.volume) : 1;
    return (this.cached = this.ease(target, dt, loud));
  }

  private ease(target: VisemeWeights, dt: number, gain: number): VisemeWeights {
    const out: VisemeWeights = {};
    for (const name of SHAPES) {
      const goal = Math.min(1, (target[name] ?? 0) * gain);
      const tau = goal > this.state[name] ? this.o.opening : this.o.closing;
      this.state[name] += (goal - this.state[name]) * (1 - Math.exp(-dt / tau));
      out[name] = this.state[name] * this.gate;
    }
    return out;
  }
}
