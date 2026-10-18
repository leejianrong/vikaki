export type KokoroDtype = "fp32" | "fp16" | "q8" | "q4";
export const DEFAULT_DTYPE: KokoroDtype;
export const MODEL_FILES: Record<KokoroDtype, string>;
export function chosenDtype(env?: Record<string, string | undefined>): KokoroDtype;
