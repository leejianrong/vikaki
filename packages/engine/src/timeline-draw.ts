import { colour, stft, type Stft } from "@vikaki/audio";
import { FRAME_FIELDS, MOUTH_SHAPES, type TimelineEvent, type TimelineRecorder, type UtteranceTimeline } from "./timeline.ts";

/** A stretch of time to show, in timeline milliseconds. */
export interface View {
  fromMs: number;
  toMs: number;
  /** Axis labels count from here (the start of the utterance, or "now" in the live view). */
  originMs: number;
  /** Draw a "now" line here (live view). */
  nowMs?: number;
}

export type LaneId = "axis" | "words" | "wave" | "spec" | "mouth" | "events";
export interface Lane {
  id: LaneId;
  top: number;
  height: number;
}

/** Pixels on the left kept for lane names. */
export const GUTTER = 74;
const GAP = 4;
const AXIS_HEIGHT = 22;
const WEIGHTS: [Exclude<LaneId, "axis">, number][] = [
  ["words", 1],
  ["wave", 1.1],
  ["spec", 2.6],
  ["mouth", 2.8],
  ["events", 1.4],
];

/** The lanes, top to bottom, filling `height` pixels. The axis is fixed; the rest share what is left by weight. */
export function layoutLanes(height: number): Lane[] {
  const free = Math.max(0, height - AXIS_HEIGHT - GAP * WEIGHTS.length);
  const total = WEIGHTS.reduce((a, [, w]) => a + w, 0);
  const lanes: Lane[] = [{ id: "axis", top: 0, height: AXIS_HEIGHT }];
  let top = AXIS_HEIGHT + GAP;
  for (const [id, w] of WEIGHTS) {
    const h = Math.floor((free * w) / total);
    lanes.push({ id, top, height: h });
    top += h + GAP;
  }
  return lanes;
}

export const timeToX = (t: number, v: View, width: number): number => GUTTER + ((t - v.fromMs) / (v.toMs - v.fromMs)) * (width - GUTTER);
export const xToTime = (x: number, v: View, width: number): number => v.fromMs + ((x - GUTTER) / (width - GUTTER)) * (v.toMs - v.fromMs);

const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000];
/** The smallest round step that leaves at most 12 ticks across `spanMs`. */
export const tickStep = (spanMs: number): number => STEPS.find((s) => spanMs / s <= 12) ?? 60_000;

/** One utterance's audio laid out on the timeline's clock as a single signal, silence where nothing was scheduled. */
export interface Signal {
  startMs: number;
  rate: number;
  samples: Float32Array;
}

const signalCache = new WeakMap<UtteranceTimeline, { key: string; signal: Signal }>();
export function utteranceSignal(u: UtteranceTimeline): Signal | undefined {
  const first = u.audio[0];
  if (!first) return undefined;
  const rate = first.sampleRate;
  const key = `${u.audio.length}:${u.audio[u.audio.length - 1]!.samples.length}:${u.endMs}`;
  const cached = signalCache.get(u);
  if (cached?.key === key) return cached.signal;
  const parts = u.audio.filter((a) => a.sampleRate === rate);
  const startMs = Math.min(...parts.map((a) => a.startMs));
  const endMs = Math.max(...parts.map((a) => a.startMs + (a.samples.length / rate) * 1000));
  const samples = new Float32Array(Math.max(0, Math.ceil(((endMs - startMs) / 1000) * rate)));
  for (const a of parts) {
    const at = Math.round(((a.startMs - startMs) / 1000) * rate);
    samples.set(a.samples.subarray(0, Math.max(0, Math.min(a.samples.length, samples.length - at))), at);
  }
  const signal = { startMs, rate, samples };
  signalCache.set(u, { key, signal });
  return signal;
}

/** For each pixel column, the lowest and highest sample in it. `has[c]` is 0 where there is no audio. */
export function waveformColumns(signals: Signal[], v: View, columns: number): { min: Float32Array; max: Float32Array; has: Uint8Array } {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const has = new Uint8Array(columns);
  const span = v.toMs - v.fromMs;
  for (const s of signals) {
    for (let c = 0; c < columns; c++) {
      const t0 = v.fromMs + (c * span) / columns;
      const t1 = v.fromMs + ((c + 1) * span) / columns;
      let i0 = Math.floor(((t0 - s.startMs) / 1000) * s.rate);
      const i1 = Math.min(s.samples.length, Math.ceil(((t1 - s.startMs) / 1000) * s.rate));
      i0 = Math.max(0, i0);
      if (i1 <= i0) continue;
      const stride = Math.max(1, Math.floor((i1 - i0) / 256));
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = i0; i < i1; i += stride) {
        const x = s.samples[i]!;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      min[c] = lo;
      max[c] = hi;
      has[c] = 1;
    }
  }
  return { min, max, has };
}

const SPEC_WINDOW = 512;
const SPEC_RANGE_DB = 70;
const SPEC_MAX_HZ = 8000;
interface Levels {
  stft: Stft;
  /** 0 to 255 per (frame, bin up to 8 kHz). */
  levels: Uint8Array;
  bins: number;
  hop: number;
}
const levelCache = new WeakMap<Float32Array, Levels>();
function levelsOf(s: Signal): Levels {
  const cached = levelCache.get(s.samples);
  if (cached) return cached;
  const hop = Math.max(1, Math.round(s.rate * 0.008));
  const t = stft(s.samples, s.rate, SPEC_WINDOW, hop);
  const bins = Math.min(t.bins, Math.floor(SPEC_MAX_HZ / t.binHz) + 1);
  let top = 1e-9;
  for (let f = 0; f < t.frames; f++) for (let k = 0; k < bins; k++) top = Math.max(top, t.mag[f * t.bins + k]!);
  const levels = new Uint8Array(t.frames * bins);
  for (let f = 0; f < t.frames; f++) {
    for (let k = 0; k < bins; k++) {
      const db = 20 * Math.log10(Math.max(t.mag[f * t.bins + k]!, 1e-9) / top);
      levels[f * bins + k] = Math.round(Math.min(1, Math.max(0, 1 + db / SPEC_RANGE_DB)) * 255);
    }
  }
  const out = { stft: t, levels, bins, hop };
  levelCache.set(s.samples, out);
  return out;
}

const RAMP = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) lut.set(colour(i / 255).map(Math.round), i * 3);
  return lut;
})();

/** RGBA pixels (`columns` by `rows`, low frequencies at the bottom) of the spectrogram of whatever audio falls in the view. */
export function spectrogramPixels(signals: Signal[], v: View, columns: number, rows: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(columns * rows * 4);
  const span = v.toMs - v.fromMs;
  for (const s of signals) {
    const l = levelsOf(s);
    for (let c = 0; c < columns; c++) {
      const t = v.fromMs + ((c + 0.5) * span) / columns;
      const frame = Math.round(((t - s.startMs) / 1000) * (s.rate / l.hop) - SPEC_WINDOW / 2 / l.hop);
      if (frame < 0 || frame >= l.stft.frames) continue;
      for (let r = 0; r < rows; r++) {
        const bin = Math.min(l.bins - 1, Math.floor((1 - (r + 0.5) / rows) * l.bins));
        const level = l.levels[frame * l.bins + bin]!;
        const at = (r * columns + c) * 4;
        px[at] = RAMP[level * 3]!;
        px[at + 1] = RAMP[level * 3 + 1]!;
        px[at + 2] = RAMP[level * 3 + 2]!;
        px[at + 3] = 255;
      }
    }
  }
  return px;
}

// ---- drawing ----

export type Theme = Record<string, string>;
const ROLES = [
  "surface-container-lowest",
  "surface-container",
  "surface-container-high",
  "on-surface",
  "on-surface-variant",
  "outline",
  "outline-variant",
  "primary",
  "primary-container",
  "on-primary-container",
  "secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "error",
  "success",
  "warning",
] as const;
/** The Material colour roles the timeline uses, read from the page's computed style so it follows light and dark. */
export function readTheme(el: Element = document.documentElement): Theme {
  const style = getComputedStyle(el);
  const theme: Theme = {};
  for (const r of ROLES) theme[r] = style.getPropertyValue(`--md-sys-color-${r}`).trim() || "#808080";
  return theme;
}

const SHAPE_ROLE: Record<(typeof MOUTH_SHAPES)[number], string> = { aa: "primary", ih: "tertiary", ou: "secondary", ee: "success", oh: "warning" };
/** A different dash for each line as well as a different colour, so they can be told apart without colour. */
const SHAPE_DASH: Record<(typeof MOUTH_SHAPES)[number], number[]> = { aa: [], ih: [7, 3], ou: [1.5, 2.5], ee: [7, 3, 1.5, 3], oh: [12, 4] };
const LANE_LABEL: Record<LaneId, string> = { axis: "", words: "words", wave: "wave", spec: "spectrum", mouth: "mouth", events: "events" };
/** Glyph and colour role for each event kind. Events from the driver (`driver:*`, `sent`, `cancel`) go on the lower row. */
const EVENT_STYLE: Record<string, { glyph: string; role: string; label: string }> = {
  sent: { glyph: "◆", role: "tertiary", label: "sent" },
  cancel: { glyph: "✕", role: "error", label: "cancel" },
  started: { glyph: "▶", role: "success", label: "start" },
  finished: { glyph: "■", role: "success", label: "end" },
  interrupted: { glyph: "✕", role: "error", label: "cut" },
  error: { glyph: "!", role: "warning", label: "error" },
  blink: { glyph: "·", role: "on-surface-variant", label: "" },
  "driver:started": { glyph: "▶", role: "secondary", label: "start" },
  "driver:finished": { glyph: "■", role: "secondary", label: "end" },
  "driver:interrupted": { glyph: "✕", role: "secondary", label: "cut" },
};
export const isDriverEvent = (kind: string) => kind === "sent" || kind === "cancel" || kind.startsWith("driver:");

let scratch: HTMLCanvasElement | undefined;

/** Paint the whole timeline into a canvas context of `width` by `height` CSS pixels. */
export function drawTimeline(ctx: CanvasRenderingContext2D, width: number, height: number, rec: TimelineRecorder, v: View, theme: Theme): void {
  const lanes = layoutLanes(height);
  const lane = (id: LaneId) => lanes.find((l) => l.id === id)!;
  const plotW = Math.max(1, Math.floor(width - GUTTER));
  const x = (t: number) => timeToX(t, v, width);
  const col = (role: string) => theme[role] ?? "#808080";
  const mono = `500 11px ${getComputedStyle(document.body).getPropertyValue("--vk-mono") || "monospace"}`;
  const plain = "500 11px system-ui, sans-serif";

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = col("surface-container-lowest");
  ctx.fillRect(0, 0, width, height);

  // lane backgrounds and names
  for (const l of lanes) {
    if (l.id === "axis") continue;
    ctx.fillStyle = col("surface-container");
    ctx.fillRect(GUTTER, l.top, plotW, l.height);
    ctx.fillStyle = col("on-surface-variant");
    ctx.font = plain;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(LANE_LABEL[l.id], 6, l.top + (l.id === "spec" ? l.height / 2 : Math.min(l.height / 2, 11)));
  }

  // axis
  const axis = lane("axis");
  const step = tickStep(v.toMs - v.fromMs);
  ctx.font = mono;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let t = Math.ceil((v.fromMs - v.originMs) / step) * step + v.originMs; t <= v.toMs; t += step) {
    const px = x(t);
    ctx.fillStyle = col("outline-variant");
    ctx.fillRect(Math.round(px), axis.height - 5, 1, 5);
    ctx.fillRect(Math.round(px), axis.height + GAP, 1, height - axis.height - GAP);
    ctx.fillStyle = col("on-surface-variant");
    const s = (t - v.originMs) / 1000;
    if (px > width - 16) continue; // its label would be cut off by the edge
    ctx.fillText(`${s > 0 && v.nowMs !== undefined ? "+" : ""}${Number.isInteger(s) ? s : s.toFixed(step < 100 ? 2 : 1)}s`, px, axis.height / 2 - 2);
  }

  const utterances = rec.utterances().filter((u) => u.endMs >= v.fromMs && u.startMs <= v.toMs);

  // words
  const words = lane("words");
  ctx.textAlign = "left";
  ctx.font = plain;
  for (const u of utterances) {
    for (const p of u.pieces) {
      const x0 = Math.max(GUTTER, x(p.startMs));
      const x1 = Math.min(width, x(p.endMs));
      if (x1 - x0 < 1) continue;
      ctx.fillStyle = col("secondary-container");
      ctx.beginPath();
      ctx.roundRect(x0, words.top + 2, Math.max(2, x1 - x0 - 1), words.height - 4, 6);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, words.top, Math.max(0, x1 - x0 - 1), words.height);
      ctx.clip();
      ctx.fillStyle = col("on-secondary-container");
      ctx.fillText(p.text || `piece ${p.index + 1}`, x0 + 6, words.top + words.height / 2);
      ctx.restore();
    }
  }

  const signals = utterances.map(utteranceSignal).filter((s): s is Signal => s !== undefined);

  // waveform
  const wave = lane("wave");
  const wf = waveformColumns(signals, v, plotW);
  ctx.fillStyle = col("secondary");
  const mid = wave.top + wave.height / 2;
  for (let c = 0; c < plotW; c++) {
    if (!wf.has[c]) continue;
    const hi = Math.min(1, wf.max[c]!) * (wave.height / 2);
    const lo = Math.max(-1, wf.min[c]!) * (wave.height / 2);
    ctx.fillRect(GUTTER + c, mid - Math.max(hi, 0.5), 1, Math.max(1, hi - lo));
  }

  // spectrogram
  const spec = lane("spec");
  if (signals.length > 0 && spec.height > 0) {
    const pixels = spectrogramPixels(signals, v, plotW, spec.height);
    scratch ??= document.createElement("canvas");
    scratch.width = plotW;
    scratch.height = spec.height;
    scratch.getContext("2d")!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, plotW, spec.height), 0, 0);
    ctx.drawImage(scratch, GUTTER, spec.top);
  }
  ctx.fillStyle = col("on-surface-variant");
  ctx.font = mono;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("8k", GUTTER - 5, spec.top + 1);
  ctx.textBaseline = "bottom";
  ctx.fillText("0", GUTTER - 5, spec.top + spec.height - 1);

  // mouth: five commanded shapes as lines, the displayed openness as a filled area, loudness dotted
  const mouth = lane("mouth");
  const fr = rec.frames(v.fromMs - 100, v.toMs + 100);
  const yOf = (value: number) => mouth.top + mouth.height - 1 - Math.min(1, Math.max(0, value)) * (mouth.height - 2);
  ctx.strokeStyle = col("outline-variant");
  ctx.lineWidth = 1;
  for (const g of [0, 0.5, 1]) {
    ctx.beginPath();
    ctx.moveTo(GUTTER, Math.round(yOf(g)) + 0.5);
    ctx.lineTo(width, Math.round(yOf(g)) + 0.5);
    ctx.stroke();
  }
  if (fr.count > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, mouth.top, plotW, mouth.height);
    ctx.clip();
    ctx.fillStyle = col("primary");
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.moveTo(x(fr.t[0]!), yOf(0));
    for (let i = 0; i < fr.count; i++) {
      const base = i * FRAME_FIELDS + MOUTH_SHAPES.length;
      ctx.lineTo(x(fr.t[i]!), yOf(Math.max(...fr.data.subarray(base, base + MOUTH_SHAPES.length))));
    }
    ctx.lineTo(x(fr.t[fr.count - 1]!), yOf(0));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    MOUTH_SHAPES.forEach((shape, k) => {
      ctx.strokeStyle = col(SHAPE_ROLE[shape]);
      ctx.setLineDash(SHAPE_DASH[shape]);
      ctx.beginPath();
      for (let i = 0; i < fr.count; i++) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, x(fr.t[i]!), yOf(fr.data[i * FRAME_FIELDS + k]!));
      ctx.stroke();
    });
    ctx.setLineDash([1, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = col("on-surface-variant");
    ctx.beginPath();
    for (let i = 0; i < fr.count; i++) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, x(fr.t[i]!), yOf(fr.data[i * FRAME_FIELDS + FRAME_FIELDS - 2]!));
    ctx.stroke();
    ctx.restore();
  }
  // a key for the five lines, in one row under the lane name
  ctx.font = "500 9px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  MOUTH_SHAPES.forEach((shape, k) => {
    ctx.fillStyle = col(SHAPE_ROLE[shape]);
    ctx.fillText(shape, 6 + k * 13.5, mouth.top + 25);
    ctx.strokeStyle = col(SHAPE_ROLE[shape]);
    ctx.lineWidth = 1.5;
    ctx.setLineDash(SHAPE_DASH[shape].map((d) => d * 0.5));
    ctx.beginPath();
    ctx.moveTo(6 + k * 13.5, mouth.top + 32);
    ctx.lineTo(6 + k * 13.5 + 11, mouth.top + 32);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // events: the page's own on the upper row, the driver's on the lower
  const events = lane("events");
  ctx.textAlign = "center";
  ctx.font = plain;
  const rowH = events.height / 2;
  const lastLabel = [-Infinity, -Infinity]; // where each row last wrote a word, so words never overprint each other
  for (const e of rec.events()) {
    if (e.t < v.fromMs || e.t > v.toMs) continue;
    const st = EVENT_STYLE[e.kind] ?? { glyph: "●", role: "on-surface", label: e.kind };
    const row = isDriverEvent(e.kind) ? 1 : 0;
    const px = x(e.t);
    ctx.fillStyle = col(st.role);
    ctx.textBaseline = "middle";
    const room = px - lastLabel[row]! >= 30;
    ctx.fillText(st.glyph, px, events.top + row * rowH + (st.label && room ? rowH * 0.32 : rowH / 2));
    if (st.label && room) {
      lastLabel[row] = px;
      ctx.font = "500 9px system-ui, sans-serif";
      ctx.fillText(st.label, px, events.top + row * rowH + rowH * 0.78);
      ctx.font = plain;
    }
  }

  // where speech was cut off, and "now"
  for (const u of utterances) {
    if (u.interruptedAtMs === undefined || u.interruptedAtMs < v.fromMs || u.interruptedAtMs > v.toMs) continue;
    ctx.fillStyle = col("error");
    ctx.globalAlpha = 0.6;
    ctx.fillRect(Math.round(x(u.interruptedAtMs)), AXIS_HEIGHT, 1, height - AXIS_HEIGHT);
    ctx.globalAlpha = 1;
  }
  if (v.nowMs !== undefined && v.nowMs >= v.fromMs && v.nowMs <= v.toMs) {
    ctx.fillStyle = col("primary");
    ctx.fillRect(Math.round(x(v.nowMs)), 0, 2, height);
  }
}

export type { TimelineEvent };
