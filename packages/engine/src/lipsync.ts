import type { WLipSyncAudioNode } from "wlipsync";
import type { MouthDriver } from "./mouth.ts";
import type { VisemeWeights } from "./renderer.ts";
import { toVisemeWeights } from "./viseme-map.ts";

/**
 * Audio in, mouth shape weights out (ADR-0007). Connect any audio source (mic or TTS
 * playback) to `node`; read `weights` every frame. The node smooths and noise-gates itself.
 */
export class LipSync implements MouthDriver {
  private constructor(readonly node: WLipSyncAudioNode) {}

  /** `profile` is a URL to fetch or the profile bytes themselves (when a page cannot fetch). */
  static async create(ctx: AudioContext, profile: string | ArrayBuffer): Promise<LipSync> {
    let bytes: ArrayBuffer;
    if (typeof profile === "string") {
      const res = await fetch(profile);
      if (!res.ok) throw new Error(`could not load lip-sync profile ${profile}: HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
    } else {
      bytes = profile;
    }
    // Loaded on demand: the library compiles WASM at import time, which would delay anything that
    // imports this file (the meeting extension must install its camera patch immediately).
    const { createWLipSyncNode, parseBinaryProfile } = await import("wlipsync");
    return new LipSync(await createWLipSyncNode(ctx, parseBinaryProfile(bytes)));
  }

  /** The source must not also be routed through this node to speakers; the node produces no audio. */
  connect(source: AudioNode): void {
    source.connect(this.node);
  }

  /** Smoothed loudness in [0, 1]. */
  get volume(): number {
    return this.node.volume;
  }

  get weights(): VisemeWeights {
    return toVisemeWeights(this.node.weights, this.node.volume);
  }
}
