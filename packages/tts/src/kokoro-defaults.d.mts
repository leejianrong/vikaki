export type KokoroDtype = "fp32" | "fp16" | "q8" | "q4";
export const DEFAULT_DTYPE: KokoroDtype;
export const MODEL_FILES: Record<KokoroDtype, string>;
export function chosenDtype(env?: Record<string, string | undefined>): KokoroDtype;

/** Where the model's input comes from: kokoro-js's eSpeak NG path, or our own dictionary phonemes (ADR-0051). */
export const DEFAULT_G2P: "espeak" | "own";
export function chosenG2p(env?: Record<string, string | undefined>): "espeak" | "own";
