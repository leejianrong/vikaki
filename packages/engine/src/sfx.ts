// Sound effects for the table (VIK-122): chips, cards, a chime for a new hand, a stinger for a win. All made here out of oscillators and filtered noise,
// so there is no sample file to license or load. `cuesFor` says which sound and when; this makes it, on the page's audio clock, beside the speech.
// Nothing sounds until the browser lets the page make sound (the same unlock as the voices), and the volume and mute are remembered.
import type { AudioSession } from "./audio-session.ts";
import type { Cue, SoundName } from "./sfx-cues.ts";

const KEY = "vikaki.sfx";
/** The master level at full volume: effects sit under the voices. */
const MASTER = 0.7;

type Recipe = (c: Ctx, t: number) => void;

interface Ctx {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

function burst(c: Ctx, t: number, o: { type: BiquadFilterType; freq: number; q?: number; dur: number; gain: number; to?: number }): void {
  const src = c.ctx.createBufferSource();
  src.buffer = c.noise;
  const f = c.ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = c.ctx.createGain();
  g.gain.setValueAtTime(o.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(c.out);
  src.start(t, Math.random() * 0.5, o.dur + 0.05);
}

function tone(c: Ctx, t: number, o: { type: OscillatorType; freq: number; to?: number; dur: number; gain: number; attack?: number; lowpass?: number }): void {
  const osc = c.ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const g = c.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  let node: AudioNode = osc;
  if (o.lowpass) {
    const f = c.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lowpass;
    node = osc.connect(f);
  }
  node.connect(g).connect(c.out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

/** One chip meeting another: a short, bright click with a ring. */
const clink = (c: Ctx, t: number, pitch = 1, gain = 0.5): void => {
  burst(c, t, { type: "bandpass", freq: 4200 * pitch, q: 3, dur: 0.05, gain });
  tone(c, t, { type: "sine", freq: 2600 * pitch, to: 2200 * pitch, dur: 0.09, gain: gain * 0.35 });
};

export const RECIPES: Record<SoundName, Recipe> = {
  chips: (c, t) => [0, 0.045, 0.1].forEach((d, i) => clink(c, t + d, 0.9 + i * 0.12)),
  sweep: (c, t) => {
    burst(c, t, { type: "bandpass", freq: 1800, to: 500, q: 0.8, dur: 0.32, gain: 0.5 });
    [0.12, 0.2, 0.27].forEach((d, i) => clink(c, t + d, 0.8 + i * 0.1, 0.3));
  },
  cascade: (c, t) => {
    for (let i = 0; i < 12; i++) clink(c, t + i * 0.06 + i * i * 0.0025, 0.75 + ((i * 7) % 5) * 0.1, 0.4);
  },
  deal: (c, t) => burst(c, t, { type: "highpass", freq: 2500, to: 6000, dur: 0.09, gain: 0.45 }),
  flip: (c, t) => {
    burst(c, t, { type: "bandpass", freq: 3200, q: 1.5, dur: 0.06, gain: 0.5 });
    tone(c, t, { type: "sine", freq: 180, to: 90, dur: 0.08, gain: 0.3 });
  },
  fold: (c, t) => burst(c, t, { type: "lowpass", freq: 2400, to: 500, dur: 0.22, gain: 0.4 }),
  chime: (c, t) => {
    tone(c, t, { type: "sine", freq: 1046.5, dur: 0.7, gain: 0.35 });
    tone(c, t + 0.14, { type: "sine", freq: 1568, dur: 0.9, gain: 0.3 });
  },
  win: (c, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + i * 0.09, { type: "triangle", freq: f, dur: 0.5, gain: 0.35 }));
    tone(c, t + 0.4, { type: "triangle", freq: 1318.5, dur: 1.0, gain: 0.3 });
  },
  allin: (c, t) => {
    for (let i = 0, at = 0; i < 14; i++, at += 0.11 - i * 0.004) tone(c, t + at, { type: "sine", freq: 120, to: 70, dur: 0.12, gain: 0.25 + i * 0.02 });
    tone(c, t + 1.0, { type: "sine", freq: 90, to: 45, dur: 0.6, gain: 0.5 });
  },
  tick: (c, t) => tone(c, t, { type: "square", freq: 1500, dur: 0.025, gain: 0.06, lowpass: 3000 }),
  knock: (c, t) => {
    tone(c, t, { type: "sine", freq: 220, to: 110, dur: 0.1, gain: 0.55 });
    burst(c, t, { type: "lowpass", freq: 1200, dur: 0.04, gain: 0.35 });
  },
  push: (c, t) => {
    burst(c, t, { type: "bandpass", freq: 900, to: 1800, q: 1, dur: 0.22, gain: 0.35 });
    [0.1, 0.16, 0.21].forEach((d, i) => clink(c, t + d, 0.85 + i * 0.1, 0.3));
  },
  bust: (c, t) => {
    tone(c, t, { type: "sawtooth", freq: 392, dur: 0.45, gain: 0.2, lowpass: 1400 });
    tone(c, t + 0.28, { type: "sawtooth", freq: 293.66, to: 261.63, dur: 0.9, gain: 0.2, lowpass: 1200 });
  },
};

export class Sfx {
  volume = 0.6;
  muted = false;
  /** Every cue asked for while unmuted, in order, whether or not the browser let it sound: for tests. */
  readonly cues: SoundName[] = [];
  private bus?: { ctx: AudioContext; gain: GainNode; noise: AudioBuffer };

  constructor(private readonly session: AudioSession) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { volume?: number; muted?: boolean };
      if (typeof saved.volume === "number") this.volume = Math.min(1, Math.max(0, saved.volume));
      this.muted = saved.muted === true;
    } catch {
      /* no storage: the defaults */
    }
  }

  set(o: { volume?: number; muted?: boolean }): void {
    if (o.volume !== undefined) this.volume = Math.min(1, Math.max(0, o.volume));
    if (o.muted !== undefined) this.muted = o.muted;
    if (this.bus) this.bus.gain.gain.value = this.muted ? 0 : this.volume * MASTER;
    try {
      localStorage.setItem(KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch {
      /* not remembered */
    }
  }

  /** Play what `cuesFor` called for. */
  play(cues: Cue[]): void {
    if (this.muted || this.volume === 0) return;
    for (const cue of cues) this.cues.push(cue.sound);
    const bus = this.ensure();
    if (!bus) return; // the browser has not allowed sound yet: the effects wait for the same click as the voices
    const now = bus.ctx.currentTime;
    for (const cue of cues) RECIPES[cue.sound]({ ctx: bus.ctx, out: bus.gain, noise: bus.noise }, now + cue.at);
  }

  private ensure(): { ctx: AudioContext; gain: GainNode; noise: AudioBuffer } | undefined {
    const ctx = this.session.context;
    if (!ctx) return undefined;
    if (this.bus?.ctx !== ctx) {
      const gain = ctx.createGain();
      gain.gain.value = this.muted ? 0 : this.volume * MASTER;
      gain.connect(ctx.destination);
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.bus = { ctx, gain, noise };
    }
    return this.bus;
  }
}
