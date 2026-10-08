import { encodePng } from "./png.ts";

/** In-place radix-2 FFT. `re` and `im` must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export interface Stft {
  /** Magnitudes, `frames` rows of `bins` values. Bin k is at k * binHz. */
  mag: Float32Array;
  /** Root mean square of the raw samples under each frame. */
  rms: Float32Array;
  frames: number;
  bins: number;
  binHz: number;
  /** Seconds between frame starts. */
  hopSec: number;
  windowSec: number;
}

/** Short-time Fourier transform with a Hann window. */
export function stft(samples: Float32Array, sampleRate: number, size = 512, hop = 128): Stft {
  const frames = samples.length < size ? 0 : 1 + Math.floor((samples.length - size) / hop);
  const bins = size / 2 + 1;
  const mag = new Float32Array(frames * bins);
  const rms = new Float32Array(frames);
  const window = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    let sq = 0;
    for (let i = 0; i < size; i++) {
      const v = samples[f * hop + i]!;
      sq += v * v;
      re[i] = v * window[i]!;
      im[i] = 0;
    }
    rms[f] = Math.sqrt(sq / size);
    fft(re, im);
    for (let k = 0; k < bins; k++) mag[f * bins + k] = Math.hypot(re[k]!, im[k]!);
  }
  return { mag, rms, frames, bins, binHz: sampleRate / size, hopSec: hop / sampleRate, windowSec: size / sampleRate };
}

// A dark-to-bright ramp (similar to "inferno"); loud is bright.
const RAMP: [number, number, number][] = [
  [0, 0, 4],
  [66, 10, 104],
  [147, 38, 103],
  [221, 81, 58],
  [252, 165, 10],
  [252, 255, 164],
];
function colour(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface SpectrogramImageOptions {
  /** Highest frequency drawn. Speech has little above this. */
  maxHz?: number;
  /** Dynamic range shown below the loudest point, in dB. */
  rangeDb?: number;
  /** Pixels per frequency bin, vertically. */
  scaleY?: number;
  /** Widest picture in columns; longer audio gets a coarser hop. */
  maxColumns?: number;
}

/** Draw a spectrogram as a PNG, time to the right, low frequencies at the bottom, with a tick every 500 ms and every kHz. */
export function spectrogramPng(samples: Float32Array, sampleRate: number, o: SpectrogramImageOptions = {}): Buffer {
  const maxHz = Math.min(o.maxHz ?? 8000, sampleRate / 2);
  const rangeDb = o.rangeDb ?? 70;
  const scaleY = o.scaleY ?? 2;
  const maxColumns = o.maxColumns ?? 1600;
  const size = 512;
  const hop = Math.max(128, Math.ceil(samples.length / maxColumns));
  const s = stft(samples, sampleRate, size, hop);
  const bins = Math.min(s.bins, Math.floor(maxHz / s.binHz) + 1);
  const left = 8;
  const bottom = 8;
  const plotW = Math.max(1, s.frames);
  const plotH = bins * scaleY;
  const w = left + plotW;
  const h = plotH + bottom;
  const px = new Uint8Array(w * h * 3).fill(255);
  let top = 1e-9;
  for (let f = 0; f < s.frames; f++) for (let k = 0; k < bins; k++) top = Math.max(top, s.mag[f * s.bins + k]!);
  const set = (x: number, y: number, c: [number, number, number]) => {
    const at = (y * w + x) * 3;
    px[at] = c[0];
    px[at + 1] = c[1];
    px[at + 2] = c[2];
  };
  for (let f = 0; f < s.frames; f++) {
    for (let k = 0; k < bins; k++) {
      const db = 20 * Math.log10(Math.max(s.mag[f * s.bins + k]!, 1e-9) / top);
      const c = colour(1 + db / rangeDb);
      for (let dy = 0; dy < scaleY; dy++) set(left + f, plotH - 1 - (k * scaleY + dy), c);
    }
  }
  const ink: [number, number, number] = [60, 60, 60];
  const dur = samples.length / sampleRate;
  for (let t = 0; t <= dur; t += 0.5) {
    const x = left + Math.round((t * sampleRate - size / 2) / hop);
    if (x < left || x >= w) continue;
    const len = Number.isInteger(t) ? 6 : 3;
    for (let y = plotH; y < plotH + len; y++) set(x, y, ink);
  }
  for (let hz = 0; hz <= maxHz; hz += 1000) {
    const y = plotH - 1 - Math.round((hz / s.binHz) * scaleY);
    if (y < 0 || y >= plotH) continue;
    for (let x = 0; x < (hz % 4000 === 0 ? 6 : 3); x++) set(x, y, ink);
  }
  return encodePng(w, h, px);
}
