// Loading Kokoro and making speech with it, as plain JavaScript so a worker thread can run it (see WorkerTts and
// KokoroTts). `create` returns an engine: { name, voices, synthesize(request) }.

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
      if (signal?.aborted) return;
      let result;
      try {
        result = await engine.generate(text, { voice: wanted && voices.includes(wanted) ? wanted : voice });
      } catch (err) {
        throw failure(`Kokoro failed: ${err.message}`, err);
      }
      if (signal?.aborted) return; // cancelled while generating; the audio is no longer wanted
      yield { samples: result.audio, sampleRate: result.sampling_rate };
    },
  };
}
