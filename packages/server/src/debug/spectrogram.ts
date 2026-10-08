import { colour, stft } from "@vikaki/audio";
import { encodePng } from "./png.ts";

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
