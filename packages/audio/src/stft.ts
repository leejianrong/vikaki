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
export function colour(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
