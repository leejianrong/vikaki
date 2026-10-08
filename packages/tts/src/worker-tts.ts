import { Worker } from "node:worker_threads";
import { TtsError, type AudioChunk, type SynthesisRequest, type Tts } from "./types.ts";

export interface WorkerTtsOptions {
  /** A JavaScript module exporting `create(options)`, which returns an engine: `{ name, voices?, synthesize(request) }`. */
  module: string | URL;
  /** Passed to `create`. Must be plain data. */
  options?: unknown;
  /** How long `close()` waits for work in progress before stopping the worker regardless. */
  closeWaitMs?: number;
}

interface Stream {
  push(chunk: AudioChunk): void;
  end(error?: Error): void;
}

/**
 * Runs a text-to-speech engine in a worker thread. A real engine does long stretches of work on the thread it runs
 * on (Kokoro held the whole process for up to 1.8 s), and the hub shares that thread with every connection it
 * relays, so in-process it delayed `speech_started` and would delay a `cancel`. In a worker the hub stays responsive.
 *
 * Audio comes back chunk by chunk, with the buffers handed over rather than copied. Aborting a request tells the worker,
 * and the iterator ends at once; an engine that cannot stop mid-sentence (Kokoro) finishes it and the result is dropped.
 */
export class WorkerTts implements Tts {
  private nextId = 1;
  private readonly streams = new Map<number, Stream>();
  /** Requests the worker has not finished, including ones abandoned by an abort: it is still working on those. */
  private readonly busy = new Set<number>();

  private constructor(
    private readonly worker: Worker,
    readonly name: string,
    readonly voices: string[],
    private readonly closeWaitMs: number,
  ) {
    worker.on("message", (m) => this.onMessage(m));
    const lost = (err: Error) => {
      for (const s of this.streams.values()) s.end(new TtsError(`the speech engine stopped: ${err.message}`, { cause: err }));
      this.streams.clear();
      this.busy.clear();
    };
    worker.on("error", lost);
    worker.on("exit", (code) => lost(new Error(`worker exited with code ${code}`)));
  }

  static async create(o: WorkerTtsOptions): Promise<WorkerTts> {
    const worker = new Worker(new URL("./tts-worker.mjs", import.meta.url), { workerData: { module: String(o.module), options: o.options } });
    worker.unref(); // an engine left running must not keep the process alive
    return new Promise<WorkerTts>((resolve, reject) => {
      const fail = (err: Error) => reject(err);
      worker.once("error", fail);
      worker.once("exit", (code) => fail(new Error(`the speech engine worker exited with code ${code} before it was ready`)));
      worker.on("message", function first(m) {
        if (m.type === "ready") {
          worker.off("message", first);
          worker.off("error", fail);
          resolve(new WorkerTts(worker, m.name, m.voices, o.closeWaitMs ?? 10_000));
        } else if (m.type === "init-error") {
          worker.off("message", first);
          void worker.terminate();
          fail(new TtsError(m.message));
        }
      });
    });
  }

  async *synthesize(request: SynthesisRequest): AsyncGenerator<AudioChunk> {
    if (request.signal?.aborted) return;
    const id = this.nextId++;
    const queue: AudioChunk[] = [];
    let finished = false;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;
    const poke = () => {
      wake?.();
      wake = undefined;
    };
    this.streams.set(id, {
      push: (c) => (queue.push(c), poke()),
      end: (e) => ((finished = true), (failure = e), poke()),
    });
    const abort = () => {
      this.worker.postMessage({ type: "abort", id });
      finished = true;
      poke();
    };
    request.signal?.addEventListener("abort", abort, { once: true });
    this.busy.add(id);
    this.worker.postMessage({ type: "synth", id, text: request.text, voice: request.voice });
    try {
      for (;;) {
        const next = queue.shift();
        if (next) {
          if (request.signal?.aborted) return;
          yield next;
        } else if (finished) {
          if (failure && !request.signal?.aborted) throw failure;
          return;
        } else {
          await new Promise<void>((r) => (wake = r));
        }
      }
    } finally {
      request.signal?.removeEventListener("abort", abort);
      this.streams.delete(id);
    }
  }

  /**
   * Stop the worker once the work it is doing has finished. An engine running native code (Kokoro's ONNX runtime)
   * can abort the whole process if its thread is killed mid-run, and a sentence nobody wants any more still runs to the end.
   */
  async close(): Promise<void> {
    const deadline = Date.now() + this.closeWaitMs;
    while (this.busy.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    await this.worker.terminate();
  }

  private onMessage(m: { type: string; id: number; samples?: Float32Array; sampleRate?: number; message?: string }): void {
    if (m.type === "done" || m.type === "error") this.busy.delete(m.id);
    const stream = this.streams.get(m.id);
    if (!stream) return; // aborted, and its late result is of no use
    if (m.type === "chunk") stream.push({ samples: m.samples!, sampleRate: m.sampleRate! });
    else if (m.type === "done") stream.end();
    else if (m.type === "error") stream.end(new TtsError(m.message ?? "speech failed"));
  }
}
