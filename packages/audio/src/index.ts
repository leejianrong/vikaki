export { analyse, classify, GATE, MIN_PAUSE_SEC, type Pause, type SpeechMetrics, type Verdict } from "./metrics.ts";
export { detectPitch, ProsodyTracker, type Pitch, type ProsodyCue, type ProsodyEvent } from "./prosody.ts";
export { colour, fft, stft, type Stft } from "./stft.ts";
export { decodeWav, encodeWav } from "./wav.ts";
export { estimateWordTimings, syllables, type WordTimer, type WordTiming } from "./words.ts";
