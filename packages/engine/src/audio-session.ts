import { createMouthDriver, type MouthDriver } from "./mouth.ts";
import { openMic } from "./mic.ts";

/**
 * Owns the AudioContext and the lip-sync node, and routes either the mic or an audio file
 * into it. Created lazily because browsers only start audio after a user gesture.
 */
export class AudioSession {
  private ctx?: AudioContext;
  private ls?: MouthDriver;
  private mic?: { stop(): void };
  /** Which mouth driver is running, once audio has started. */
  mouthKind?: "wlipsync" | "amplitude";
  private fileSource?: AudioBufferSourceNode;

  constructor(private readonly profileUrl: string) {}

  /** Current mouth weights, or undefined if nothing has been started yet. */
  get lipsync(): MouthDriver | undefined {
    return this.ls;
  }

  get state(): AudioContextState | "none" {
    return this.ctx?.state ?? "none";
  }

  private async ensure(): Promise<{ ctx: AudioContext; ls: MouthDriver }> {
    if (!this.ctx || !this.ls) {
      this.ctx = new AudioContext();
      const mouth = await createMouthDriver(this.ctx, this.profileUrl);
      this.ls = mouth.driver;
      this.mouthKind = mouth.kind;
    }
    await this.ctx.resume();
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
