import { createMouthDriver, type MouthDriver } from "./mouth.ts";
import type { Output } from "./playback.ts";
import { openMic } from "./mic.ts";

/**
 * Owns the AudioContext and the lip-sync node, and routes either the mic or an audio file
 * into it. Created lazily because browsers only start audio after a user gesture.
 */
export interface AudioSessionDeps {
  createContext?: () => AudioContext;
  createMouth?: typeof createMouthDriver;
}

export class AudioSession {
  private ctx?: AudioContext;
  private ls?: MouthDriver;
  private setup?: Promise<{ ctx: AudioContext; ls: MouthDriver }>;
  private mic?: { stop(): void };
  /** Which mouth driver is running, once audio has started. */
  mouthKind?: "wlipsync" | "amplitude";
  private fileSource?: AudioBufferSourceNode;

  constructor(
    private readonly profileUrl: string,
    private readonly deps: AudioSessionDeps = {},
  ) {}

  /** Current mouth weights, or undefined if nothing has been started yet. */
  get lipsync(): MouthDriver | undefined {
    return this.ls;
  }

  get state(): AudioContextState | "none" {
    return this.ctx?.state ?? "none";
  }

  /**
   * Create the audio context and mouth driver once, however many callers ask at the same time
   * (the page's speech player and a button press can both ask on load).
   */
  private async ensure(): Promise<{ ctx: AudioContext; ls: MouthDriver }> {
    this.setup ??= (async () => {
      const ctx = (this.deps.createContext ?? (() => new AudioContext()))();
      const mouth = await (this.deps.createMouth ?? createMouthDriver)(ctx, this.profileUrl);
      this.mouthKind = mouth.kind;
      // Publish both together, so `running` never says yes with the mouth driver still loading.
      this.ctx = ctx;
      this.ls = mouth.driver;
      return { ctx, ls: mouth.driver };
    })().catch((err) => {
      this.setup = undefined; // allow a retry
      throw err;
    });
    const ready = await this.setup;
    await ready.ctx.resume();
    return ready;
  }

  /** True when the browser is letting this page make sound. The context is only published once the mouth driver is ready too. */
  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** Create the audio context and lip-sync driver now, so speech can start the moment it arrives. */
  async prepare(): Promise<void> {
    await this.ensure();
  }

  /** Play through the speakers and the lip sync, on the audio clock. Needs `prepare()` first. */
  webOutput(): Output {
    const { ctx, ls } = this.require();
    return {
      now: () => ctx.currentTime,
      // Where a point on the audio clock is heard on the page's clock. The output timestamp includes the device's latency.
      perfMs: (t) => {
        const stamp = ctx.getOutputTimestamp();
        return stamp.contextTime && stamp.performanceTime ? stamp.performanceTime + (t - stamp.contextTime) * 1000 : performance.now() + (t - ctx.currentTime + (ctx.outputLatency || 0)) * 1000;
      },
      play: (samples, sampleRate, at) => {
        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        ls.connect(source);
        source.connect(ctx.destination);
        source.start(at);
        return {
          stop: () => {
            try {
              source.stop();
            } catch {
              /* already ended */
            }
          },
        };
      },
    };
  }

  private require(): { ctx: AudioContext; ls: MouthDriver } {
    if (!this.ctx || !this.ls) throw new Error("call prepare() before playing audio");
    return { ctx: this.ctx, ls: this.ls };
  }

  /** Start listening to the microphone. Audio stays in the page. */
  async startMic(): Promise<void> {
    this.stopFile();
    const { ctx, ls } = await this.ensure();
    const mic = await openMic(ctx);
    ls.connect(mic.source); // not routed to speakers, so no feedback
    this.mic = mic;
  }

  stopMic(): void {
    this.mic?.stop();
    this.mic = undefined;
  }

  /** Browsers may hold audio until the user interacts; call this from a click or key handler. */
  async resume(): Promise<void> {
    await this.ctx?.resume();
  }

  get listening(): boolean {
    return this.mic !== undefined;
  }

  /** Play an audio file through the speakers and the lip sync. Resolves when it ends. */
  async playFile(file: Blob): Promise<void> {
    this.stopMic();
    this.stopFile();
    const { ctx, ls } = await this.ensure();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    ls.connect(source);
    source.connect(ctx.destination);
    this.fileSource = source;
    await new Promise<void>((done) => {
      source.onended = () => done();
      source.start();
    });
    if (this.fileSource === source) this.fileSource = undefined;
  }

  stopFile(): void {
    const s = this.fileSource;
    this.fileSource = undefined;
    try {
      s?.stop();
    } catch {
      /* already ended */
    }
  }
}
