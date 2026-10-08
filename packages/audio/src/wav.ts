/** Minimal mono 16-bit PCM WAV reading and writing, with no Node-only APIs so it runs in the browser too. */

const ascii = (view: DataView, at: number, n: number) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at, n));

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return out;
}

export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12 || ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") throw new Error("not a WAV file");
  let sampleRate = 0;
  for (let at = 12; at + 8 <= view.byteLength; ) {
    const id = ascii(view, at, 4);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error("only mono 16-bit PCM WAV is supported");
    } else if (id === "data") {
      if (!sampleRate) throw new Error("WAV has no fmt chunk before its data");
      const n = Math.floor(Math.min(size, view.byteLength - body) / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = view.getInt16(body + i * 2, true) / 32768;
      return { samples, sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}
