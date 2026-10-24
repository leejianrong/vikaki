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
  private micAnalyser?: AnalyserNode;
  private micWindowBuffer?: Float32Array<ArrayBuffer>;
  /** Which mouth driver is running, once audio has started. */
  mouthKind?: "wlipsync" | "amplitude";
  private fileSource?: AudioBufferSourceNode;
  /** How loud the voices are (VIK-109), for someone talking over them: a level from 0 to 1 and a mute. It only changes what is heard: the lip sync listens before it, so the mouths keep moving. */
  readonly voice = { volume: 1, muted: false };
  private bus?: GainNode;

  constructor(
    private readonly profileUrl: string,
    private readonly deps: AudioSessionDeps = {},
  ) {}

  /** Current mouth weights, or undefined if nothing has been started yet. */
  get lipsync(): MouthDriver | undefined {
    return this.ls;
  }

  /** Set the voices' level or mute, live: lines already playing change at once, a thought as much as a line. */
  setVoice(o: { volume?: number; muted?: boolean }): void {
    if (o.volume !== undefined) this.voice.volume = Math.min(1, Math.max(0, o.volume));
    if (o.muted !== undefined) this.voice.muted = o.muted;
    if (this.bus) this.bus.gain.value = this.voiceGain;
  }

  /** The level the voices' gain node is at, or undefined before one exists. For tests. */
  get busGain(): number | undefined {
    return this.bus?.gain.value;
  }

  /** The gain the voices are played at now: 0 when muted. */
  get voiceGain(): number {
    return this.voice.muted ? 0 : this.voice.volume;
  }

  /** Where the voices go: through the level control when the context has one, else straight out. */
  private out(ctx: AudioContext): AudioNode {
    if (!this.bus && typeof ctx.createGain === "function") {
      this.bus = ctx.createGain();
      this.bus.gain.value = this.voiceGain;
      this.bus.connect(ctx.destination);
    }
    return this.bus ?? ctx.destination;
  }

  /** The audio context while the browser lets the page make sound, else undefined. For effects that play beside the speech (VIK-122). */
  get context(): AudioContext | undefined {
    return this.ctx?.state === "running" ? this.ctx : undefined;
  }

  get state(): AudioContextState | "none" {
    return this.ctx?.state ?? "none";
  }

  /** How many buffers have been handed to the speakers (a line heard while the browser blocked sound goes nowhere and is not counted). For tests. */
  played = 0;

  /** The audio clock in seconds, which only advances while the context is running; undefined before it exists. For tests. */
  get time(): number | undefined {
    return this.ctx?.currentTime;
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
        source.connect(this.out(ctx));
        source.start(at);
        this.played++;
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
    const analyser = ctx.createAnalyser(); // a second tap on the mic, read for prosody; it too goes nowhere
    analyser.fftSize = 2048;
    mic.source.connect(analyser);
    this.micAnalyser = analyser;
    this.micWindowBuffer = new Float32Array(analyser.fftSize);
    this.mic = mic;
  }

  stopMic(): void {
    this.mic?.stop();
    this.mic = undefined;
    this.micAnalyser?.disconnect();
    this.micAnalyser = undefined;
  }

  /** The latest ~40 ms of the mic and its sample rate, for prosody. Undefined when the mic is off. The array is reused. */
  micWindow(): { samples: Float32Array; sampleRate: number } | undefined {
    if (!this.micAnalyser || !this.micWindowBuffer || !this.ctx) return undefined;
    this.micAnalyser.getFloatTimeDomainData(this.micWindowBuffer);
    return { samples: this.micWindowBuffer, sampleRate: this.ctx.sampleRate };
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
    source.connect(this.out(ctx));
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
