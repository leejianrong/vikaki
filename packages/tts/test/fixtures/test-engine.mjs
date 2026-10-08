// An engine for testing WorkerTts: its behaviour is chosen by the text it is asked to say.
//   "chunks:N"  yields N chunks of 100 samples each (value = chunk number / 10)
//   "fail"      throws
//   "forever"   yields a chunk every 15 ms until aborted
//   "slow:MS"   works for MS milliseconds without watching for an abort, then sets flag[0] (a shared Int32Array) to 1
//   "overlap:MS" works for MS milliseconds, counting how many requests are inside the engine at once
//   "overlap-stats" yields one chunk: [the most requests that were ever inside at once, how many "overlap:" requests started]
//   "die"       takes the worker down
//   "stats"     yields one chunk: [how many "forever" requests were told to stop, how many are still running]
let stopped = 0;
let running = 0;
let inside = 0;
let mostInside = 0;
let overlapStarted = 0;

export async function create({ failToStart, flag } = {}) {
  if (failToStart) throw Object.assign(new Error("no model here"), { code: "tts_failed" });
  return {
    name: "test-engine",
    voices: ["a", "b"],
    async *synthesize({ text, voice, signal }) {
      if (text === "fail") throw new Error("the engine broke");
      if (text === "die") process.exit(3);
      if (text.startsWith("slow:")) {
        await new Promise((r) => setTimeout(r, Number(text.split(":")[1])));
        if (flag) Atomics.store(new Int32Array(flag), 0, 1);
        return;
      }
      if (text.startsWith("overlap:")) {
        overlapStarted++;
        mostInside = Math.max(mostInside, ++inside);
        await new Promise((r) => setTimeout(r, Number(text.split(":")[1])));
        inside--;
        yield { samples: new Float32Array(10), sampleRate: 8000 };
        return;
      }
      if (text === "overlap-stats") return void (yield { samples: Float32Array.of(mostInside, overlapStarted), sampleRate: 8000 });
      if (text === "stats") return void (yield { samples: Float32Array.of(stopped, running), sampleRate: 8000 });
      if (text === "forever") {
        running++;
        for (let i = 0; !signal?.aborted; i++) {
          yield { samples: new Float32Array(10).fill(0.1), sampleRate: 8000 };
          await new Promise((r) => setTimeout(r, 15));
        }
        stopped++;
        running--;
        return;
      }
      const n = Number(text.split(":")[1] ?? 1);
      for (let i = 0; i < n; i++) yield { samples: new Float32Array(100).fill((i + 1) / 10), sampleRate: voice === "b" ? 16000 : 24000 };
    },
  };
}
