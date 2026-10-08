// Loading Kokoro and making speech with it, as plain JavaScript so a worker thread can run it (see WorkerTts and
// KokoroTts). `create` returns an engine: { name, voices, synthesize(request) }.

import { gapAfter, splitLong, trimSilence } from "./split-text.mjs";

/** The longest stretch of text made in one call. A call cannot be interrupted, so this is the most a cancel can wait for (about 2 seconds). */
const MAX_PIECE_CHARS = 70;

const INSTALL_HINT =
  "Local speech needs the optional kokoro-js package (Apache-2.0, about 400 MB with its runtime). " +
  "Install it next to Vikaki with: npm install kokoro-js --onnxruntime-node-install-cuda=skip " +
  "(the flag avoids an install error on machines with CUDA 11). The first run also downloads a model of about 90 MB.";

const failure = (message, cause) => Object.assign(new Error(message, { cause }), { code: "tts_failed" });

export async function create({ importFrom = "kokoro-js", model = "onnx-community/Kokoro-82M-v1.0-ONNX", dtype = "q8", voice = "af_heart" } = {}) {
  let mod;
  try {
    mod = await import(importFrom);
  } catch (err) {
    throw failure(INSTALL_HINT, err);
  }
  let engine;
  try {
    engine = await mod.KokoroTTS.from_pretrained(model, { dtype, device: "cpu" });
  } catch (err) {
    throw failure(`could not load the Kokoro model: ${err.message}`, err);
  }
  const voices = Object.keys(engine.voices);
  return {
    name: "kokoro",
    voices,
    async *synthesize({ text, voice: wanted, signal }) {
      // A whole sentence in one call cannot be stopped, and the next line waits behind it (KAN-1961). In smaller pieces, an abort
      // lands between them; each piece's audio is delivered as soon as it is made.
      const pieces = splitLong(text, MAX_PIECE_CHARS);
      for (const [i, piece] of pieces.entries()) {
        // Let the thread's event loop turn: a message (an abort) is only handled then, and Kokoro's work holds the thread and
        // is awaited by microtasks, so without this a cancel is not seen until every piece has been made.
        await new Promise((resolve) => setImmediate(resolve));
        if (signal?.aborted) return;
        let result;
        try {
          result = await engine.generate(piece, { voice: wanted && voices.includes(wanted) ? wanted : voice });
        } catch (err) {
          throw failure(`Kokoro failed: ${err.message}`, err);
        }
        if (signal?.aborted) return; // cancelled while generating; the audio is no longer wanted
        let audio = result.audio;
        if (pieces.length > 1) {
          // Each call pads its audio with quiet. Keep the line's own start and end as they are; at a join, trim the padding and put
          // back the pause that suits where the cut fell (a long silence in the middle of a sentence sounds like a stumble).
          const rate = result.sampling_rate;
          audio = trimSilence(audio, rate, 0.03, { leading: i > 0, trailing: i < pieces.length - 1 });
          if (i < pieces.length - 1) {
            const gap = new Float32Array(Math.round(gapAfter(piece) * rate));
            const joined = new Float32Array(audio.length + gap.length);
            joined.set(audio);
            audio = joined;
          }
        }
        yield { samples: audio, sampleRate: result.sampling_rate };
      }
    },
  };
}
