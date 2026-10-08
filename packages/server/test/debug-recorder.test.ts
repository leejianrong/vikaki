import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { make } from "@vikaki/protocol";
import { FakeTts, KokoroTts } from "@vikaki/tts";
import { DebugRecorder, analyse, classify, decodeWav, startServer, type RunningServer } from "../src/server.ts";
import { safeName } from "../src/debug/index.ts";
import { Client, until, utterance } from "./helpers.ts";

let dir: string;
let debugDir: string;
let server: RunningServer | undefined;
const clients: Client[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-dbg-"));
  debugDir = join(dir, "debug");
  await writeFile(join(dir, "index.html"), "hi");
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await server?.close();
  server = undefined;
});

/** A server with the recorder on and no avatar page, so playback is simulated and the test is quick. */
async function setup(opts: { debugDir?: string; msPerChar?: number } = {}) {
  const saved: string[] = [];
  const errors: unknown[] = [];
  const recorder = new DebugRecorder({ dir: opts.debugDir ?? debugDir, onSaved: (f) => saved.push(f), onError: (e) => errors.push(e) });
  server = await startServer({ staticDir: dir, speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: opts.msPerChar ?? 20, chunkMs: 100 }), observer: recorder } });
  const driver = await Client.join(server.wsUrl, "driver");
  clients.push(driver);
  await driver.next();
  return { driver, recorder, saved, errors };
}

const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));

describe("debug recorder", () => {
  it("saves the wav, spectrogram, metrics, text and timings for an utterance", async () => {
    const { driver, saved } = await setup();
    driver.send(utterance({ utterance_id: "hello", text: "Good morning everyone. Shall we begin?" }));
    await until(() => saved.length === 1, 5000, "the recording");
    const folder = saved[0]!;
    expect((await readdir(folder)).sort()).toEqual(["audio.wav", "metrics.json", "spectrogram.png", "text.txt", "timings.json"]);

    const wav = decodeWav(await readFile(join(folder, "audio.wav")));
    expect(wav.sampleRate).toBe(16000);
    expect(wav.samples.length / wav.sampleRate).toBeGreaterThan(0.5);

    const metrics = await json(join(folder, "metrics.json"));
    expect(metrics).toMatchObject({ verdict: "buzz", sampleRate: 16000 }); // the test voice is honest about being a buzz
    expect(metrics.loudnessVariation).toBeCloseTo(analyse(wav.samples, wav.sampleRate).loudnessVariation, 2);

    expect((await readFile(join(folder, "text.txt"), "utf8")).split("\n").filter(Boolean)).toEqual(["Good morning everyone.", "Shall we begin?"]);

    const t = await json(join(folder, "timings.json"));
    expect(t).toMatchObject({ utterance_id: "hello", outcome: "completed" });
    expect(t.timeToFirstAudioMs).toBeGreaterThanOrEqual(0);
    expect(t.sentences).toHaveLength(2);
    expect(t.sentences[0].audioStartSec).toBe(0);
    expect(t.sentences[0].audioEndSec).toBeCloseTo(t.sentences[1].audioStartSec, 5); // the sentences tile the recording
    expect(t.sentences[1].audioEndSec).toBeCloseTo(t.audioSeconds, 5);
    expect(classify(metrics).verdict).toBe("buzz");
  });

  it("records a cancelled utterance as cancelled, with the audio made so far", async () => {
    const { driver, saved } = await setup({ msPerChar: 200 });
    driver.send(utterance({ utterance_id: "long", text: "Hello there my friend. This second sentence is never reached." }));
    await new Promise((r) => setTimeout(r, 50));
    driver.send(make("cancel", { utterance_id: "long" }));
    await until(() => saved.length === 1, 5000, "the recording");
    const t = await json(join(saved[0]!, "timings.json"));
    expect(t.outcome).toBe("cancelled");
    expect(t.reason).toBe("cancelled");
  });

  it("keeps an utterance id from leaving the debug directory", async () => {
    const { driver, saved } = await setup();
    driver.send(utterance({ utterance_id: "../../escape", text: "Hi." }));
    await until(() => saved.length === 1, 5000, "the recording");
    expect(saved[0]!.startsWith(debugDir + "/")).toBe(true);
    expect(saved[0]!.slice(debugDir.length + 1)).not.toContain("/");
    expect(safeName("a/b\\c..d")).toBe("a_b_c__d");
    expect(safeName("")).toBe("utterance");
  });

  it("never lets a disk problem break speech: the driver still hears speech_finished", async () => {
    const blocker = join(dir, "not-a-dir");
    await writeFile(blocker, "x");
    const { driver, errors } = await setup({ debugDir: join(blocker, "inside") });
    driver.send(utterance({ utterance_id: "ok", text: "Hi." }));
    let finished = false;
    for (let i = 0; i < 20 && !finished; i++) finished = (await driver.next()).type === "speech_finished";
    expect(finished).toBe(true);
    await until(() => errors.length === 1, 3000, "the write error");
  });
});

// Real engine, only when the voice is installed (see docs/tts.md): the gate must call real speech speech.
const kokoroPath = process.env.VIKAKI_KOKORO_PATH;
describe.skipIf(!kokoroPath)("real voice", () => {
  it("Kokoro speech passes the speech-or-buzz gate", async () => {
    const tts = await KokoroTts.create({ importFrom: kokoroPath });
    const parts: Float32Array[] = [];
    let rate = 24000;
    for await (const c of tts.synthesize({ text: "Good morning, everyone. Shall we begin?" })) {
      parts.push(c.samples);
      rate = c.sampleRate;
    }
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    expect(classify(analyse(all, rate)).verdict).toBe("speech");
  }, 120_000);
});
