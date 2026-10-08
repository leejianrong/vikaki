import { LipSync } from "./lipsync.ts";
import { rmsToVolume } from "./volume.ts";
import { scaleWeights } from "./viseme-map.ts";
import type { VisemeWeights } from "./renderer.ts";

/** Anything that turns audio into mouth weights. */
export interface MouthDriver {
  readonly weights: VisemeWeights;
  /** Smoothed loudness in [0, 1]. */
  readonly volume: number;
  connect(source: AudioNode): void;
  /** Shut the mouth at once, ignoring the audio, until `unmute`. Used when speech is cut off. */
  mute(): void;
  unmute(): void;
}

/**
 * Fallback for places where an AudioWorklet or WASM is blocked (a strict page security policy).
 * It only opens and closes the mouth with loudness, with no vowel shapes, but it never freezes.
 */
export class AmplitudeMouth implements MouthDriver {
  private readonly analyser: AnalyserNode;
  private readonly buf: Float32Array<ArrayBuffer>;
  private smoothed = 0;
  private last = 0;
  private gate = 1;

  constructor(ctx: BaseAudioContext) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  connect(source: AudioNode): void {
    source.connect(this.analyser);
  }

  private read(): void {
    const now = performance.now();
    if (now - this.last < 8) return; // several reads in one frame give one answer
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const x of this.buf) sum += x * x;
    const target = rmsToVolume(Math.sqrt(sum / this.buf.length));
    const rate = target > this.smoothed ? 30 : 12; // open quickly, close a little slower
    this.smoothed += (target - this.smoothed) * Math.min(1, rate * dt);
  }

  mute(): void {
    this.gate = 0;
  }

  unmute(): void {
    this.gate = 1;
  }

  get volume(): number {
    this.read();
    return this.smoothed * this.gate;
  }

  get weights(): VisemeWeights {
    this.read(); // refresh from the analyser first; reading `smoothed` alone would never update
    return scaleWeights({ aa: this.smoothed }, this.gate);
  }
}

export interface CreatedMouth {
  driver: MouthDriver;
  /** Which implementation is in use, so a UI or test can say so. */
  kind: "wlipsync" | "amplitude";
  /** Why wLipSync was not used, when `kind` is "amplitude". */
  reason?: string;
}

/**
 * A silent source feeding the driver. Without it, the browser stops processing the driver once
 * its real input ends (a finished audio file or speech), and the last loud reading stays frozen,
 * leaving the mouth stuck open. With it the driver keeps hearing silence, so the mouth closes.
 */
function keepAlive(ctx: AudioContext, driver: MouthDriver): void {
  const silence = ctx.createConstantSource();
  silence.offset.value = 0;
  silence.start();
  driver.connect(silence);
}

/** wLipSync if it starts, otherwise the amplitude fallback. Never throws. */
export async function createMouthDriver(ctx: AudioContext, profile: string | ArrayBuffer): Promise<CreatedMouth> {
  let created: CreatedMouth;
  try {
    created = { driver: await LipSync.create(ctx, profile), kind: "wlipsync" };
  } catch (err) {
    created = { driver: new AmplitudeMouth(ctx), kind: "amplitude", reason: (err as Error).message };
  }
  keepAlive(ctx, created.driver);
  return created;
}
