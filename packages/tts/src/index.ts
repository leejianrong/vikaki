export * from "./types.ts";
export { FakeTts, synthVowel, type FakeTtsOptions } from "./fake.ts";
export { SentenceChunker, type ChunkerOptions } from "./chunker.ts";
export { KokoroTts, type KokoroOptions } from "./kokoro.ts";
export { WorkerTts, type WorkerTtsOptions } from "./worker-tts.ts";
export { chosenDtype, DEFAULT_DTYPE, MODEL_FILES, type KokoroDtype } from "./kokoro-defaults.mjs";
