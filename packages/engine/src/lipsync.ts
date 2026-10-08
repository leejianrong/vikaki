import { createWLipSyncNode, parseBinaryProfile, type WLipSyncAudioNode } from "wlipsync";
import type { VisemeWeights } from "./renderer.ts";
import { toVisemeWeights } from "./viseme-map.ts";

/**
 * Audio in, mouth shape weights out (ADR-0007). Connect any audio source (mic or TTS
 * playback) to `node`; read `weights` every frame. The node smooths and noise-gates itself.
 */
export class LipSync {
  private constructor(readonly node: WLipSyncAudioNode) {}

  static async create(ctx: AudioContext, profileUrl: string): Promise<LipSync> {
    const res = await fetch(profileUrl);
    if (!res.ok) throw new Error(`could not load lip-sync profile ${profileUrl}: HTTP ${res.status}`);
    const node = await createWLipSyncNode(ctx, parseBinaryProfile(await res.arrayBuffer()));
    return new LipSync(node);
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
