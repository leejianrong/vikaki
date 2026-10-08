/** Minimal mono 16-bit PCM WAV reading and writing. Enough for debug recordings and test fixtures. */

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    data.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); // fmt chunk size
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 12 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let sampleRate = 0;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      const format = b.readUInt16LE(body);
      const channels = b.readUInt16LE(body + 2);
      sampleRate = b.readUInt32LE(body + 4);
      const bits = b.readUInt16LE(body + 14);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error("only mono 16-bit PCM WAV is supported");
    } else if (id === "data") {
      if (!sampleRate) throw new Error("WAV has no fmt chunk before its data");
      const n = Math.floor(Math.min(size, b.length - body) / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(body + i * 2) / 32768;
      return { samples, sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}
