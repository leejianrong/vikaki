// The worker side of WorkerTts: load an engine, then make speech on request without holding up the main thread.
// Plain JavaScript on purpose: a worker thread cannot load TypeScript here.
import { parentPort, workerData } from "node:worker_threads";

const aborts = new Map();
let engine;

const describe = (err) => ({ message: String(err?.message ?? err), code: err?.code });

try {
  const mod = await import(workerData.module);
  engine = await mod.create(workerData.options);
  parentPort.postMessage({ type: "ready", name: engine.name, voices: engine.voices ?? [] });
} catch (err) {
  parentPort.postMessage({ type: "init-error", ...describe(err) });
}

parentPort.on("message", async (m) => {
  if (m.type === "abort") return void aborts.get(m.id)?.abort();
  if (m.type !== "synth" || !engine) return;
  const controller = new AbortController();
  aborts.set(m.id, controller);
  try {
    for await (const chunk of engine.synthesize({ text: m.text, voice: m.voice, signal: controller.signal })) {
      if (controller.signal.aborted) break;
      const samples = chunk.samples.slice(); // a copy that owns its buffer, so it can be handed over without copying again
      parentPort.postMessage({ type: "chunk", id: m.id, samples, sampleRate: chunk.sampleRate }, [samples.buffer]);
    }
    parentPort.postMessage({ type: "done", id: m.id });
  } catch (err) {
    parentPort.postMessage({ type: "error", id: m.id, ...describe(err) });
  } finally {
    aborts.delete(m.id);
  }
});
