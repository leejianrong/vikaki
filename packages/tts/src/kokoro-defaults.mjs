// Which Kokoro weights to run, in one place: the engine (kokoro-core.mjs, in a worker thread), `make install-voice` and `doctor` all need to agree on it.
// Plain JavaScript for the same reason as the engine: a worker thread cannot load TypeScript.

/**
 * fp32 by default (VIK-116). On the machine it was measured on, the 8-bit `q8` weights (90 MB) took 1.4 s to make "Check." and 3.4 s for a
 * 44-character line, three times what the full-precision weights took (0.5 s and 1.1 s), for the same audio: this CPU has no fast 8-bit path.
 * The cost is a larger download (about 330 MB, against 90 MB). A machine with fast 8-bit maths may prefer `q8`: set `VIKAKI_KOKORO_DTYPE=q8`,
 * and compare with `pnpm exec tsx scripts/probe-first-audio.ts --dtype q8`.
 */
export const DEFAULT_DTYPE = "fp32";

/** The file each precision is cached as, under the model's `onnx/` folder. */
export const MODEL_FILES = { fp32: "model.onnx", fp16: "model_fp16.onnx", q8: "model_quantized.onnx", q4: "model_q4.onnx" };

/** The precision to use: `VIKAKI_KOKORO_DTYPE` if it names a known one, else the default. */
export function chosenDtype(env = process.env) {
  const wanted = env.VIKAKI_KOKORO_DTYPE;
  return wanted && Object.hasOwn(MODEL_FILES, wanted) ? wanted : DEFAULT_DTYPE;
}

/**
 * Where the model's input (phonemes) comes from: `espeak`, kokoro-js's own path through the `phonemizer` package and eSpeak NG (GPL-3.0), or `own`,
 * our dictionary-based phonemes with no eSpeak (kokoro-phonemes.mjs, ADR-0051). `VIKAKI_KOKORO_G2P` sets it.
 */
export const DEFAULT_G2P = "espeak";

export function chosenG2p(env = process.env) {
  const wanted = env.VIKAKI_KOKORO_G2P;
  return wanted === "own" || wanted === "espeak" ? wanted : DEFAULT_G2P;
}
