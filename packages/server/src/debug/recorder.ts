import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyse, classify } from "./metrics.ts";
import { spectrogramPng } from "./spectrogram.ts";
import { encodeWav } from "./wav.ts";
import type { SpeechObserver } from "../speech.ts";

interface Sentence {
  index: number;
  text: string;
  startedAt: number;
  firstAudioAt?: number;
  endedAt?: number;
  /** Where this sentence's audio sits in the utterance's recording. */
  audioStartSec?: number;
  audioEndSec?: number;
}

interface Recording {
  id: string;
  persona?: string;
  voice?: string;
  startedAt: number;
  rate: number;
  parts: Float32Array[];
  length: number;
  sentences: Sentence[];
}

export interface DebugRecorderOptions {
  /** Where recordings go, one folder per utterance. */
  dir: string;
  /** Called when a recording could not be written. Speech is never affected. */
  onError?: (err: unknown) => void;
  /** Called with the folder after a recording is written. */
  onSaved?: (folder: string) => void;
}

/** Folder-safe form of a driver-supplied id: it must never be able to leave the debug directory. */
export function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "utterance";
}

/**
 * Saves, for every utterance, what the engine produced: `audio.wav`, `spectrogram.png`,
 * `metrics.json` (with a speech-or-buzz verdict), `text.txt` and `timings.json`.
 */
export class DebugRecorder implements SpeechObserver {
  private readonly open = new Map<string, Recording>();
  private counter = 0;
  /** Resolves when every write started so far is done. Tests and shutdown await it. */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: DebugRecorderOptions) {}

  sentence: SpeechObserver["sentence"] = (e) => {
    let r = this.open.get(e.utterance_id);
    if (!r) {
      r = { id: e.utterance_id, persona: e.persona, voice: e.voice, startedAt: e.at, rate: 0, parts: [], length: 0, sentences: [] };
      this.open.set(e.utterance_id, r);
    }
    r.sentences.push({ index: e.index, text: e.text, startedAt: e.at });
  };

  audio: SpeechObserver["audio"] = (e) => {
    const r = this.open.get(e.utterance_id);
    const s = r?.sentences[e.sentence];
    if (!r || !s) return;
    r.rate ||= e.sampleRate;
    s.firstAudioAt ??= e.at;
    s.audioStartSec ??= r.length / r.rate;
    r.parts.push(e.samples.slice());
    r.length += e.samples.length;
    s.audioEndSec = r.length / r.rate;
    s.endedAt = e.at;
  };

  end: SpeechObserver["end"] = (e) => {
    const r = this.open.get(e.utterance_id);
    if (!r) return; // nothing was synthesized, so there is nothing to record
    this.open.delete(e.utterance_id);
    const folder = join(this.o.dir, `${new Date(r.startedAt).toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}-${String(++this.counter).padStart(3, "0")}-${safeName(r.id)}`);
    this.pending = this.pending
      .then(() => this.write(folder, r, e))
      .then(() => this.o.onSaved?.(folder))
      .catch((err) => this.o.onError?.(err));
  };

  /** Wait for all recordings started so far to reach the disk. */
  flush(): Promise<unknown> {
    return this.pending;
  }

  private async write(folder: string, r: Recording, e: Parameters<NonNullable<SpeechObserver["end"]>>[0]): Promise<void> {
    const samples = new Float32Array(r.length);
    let at = 0;
    for (const p of r.parts) {
      samples.set(p, at);
      at += p.length;
    }
    await mkdir(folder, { recursive: true });
    const rate = r.rate || 24000;
    const metrics = analyse(samples, rate);
    const first = r.sentences.find((s) => s.firstAudioAt !== undefined)?.firstAudioAt;
    await Promise.all([
      writeFile(join(folder, "audio.wav"), encodeWav(samples, rate)),
      writeFile(join(folder, "spectrogram.png"), spectrogramPng(samples, rate)),
      writeFile(join(folder, "metrics.json"), JSON.stringify({ ...metrics, ...classify(metrics) }, null, 2)),
      writeFile(join(folder, "text.txt"), r.sentences.map((s) => s.text).join("\n") + "\n"),
      writeFile(
        join(folder, "timings.json"),
        JSON.stringify(
          {
            utterance_id: r.id,
            persona: r.persona,
            voice: r.voice,
            outcome: e.outcome,
            reason: e.reason,
            startedAt: r.startedAt,
            endedAt: e.at,
            timeToFirstAudioMs: first === undefined ? null : first - r.startedAt,
            audioSeconds: samples.length / rate,
            sentences: r.sentences,
          },
          null,
          2,
        ),
      ),
    ]);
  }
}
