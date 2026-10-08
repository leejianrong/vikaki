import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { make } from "@vikaki/protocol";
import { WorkerTts, type Tts } from "@vikaki/tts";
import { startServer, type RunningServer } from "../src/server.ts";
import { Client, until, utterance } from "./helpers.ts";

const engineModule = new URL("./fixtures/blocking-engine.mjs", import.meta.url);
const OPTIONS = { blocks: 3, blockMs: 700 }; // each sentence holds its thread for 2.1 s, in three stretches of 0.7 s

let dir: string;
let server: RunningServer | undefined;
let tts: (Tts & { close?(): Promise<void> }) | undefined;
const clients: Client[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-stall-"));
  await writeFile(join(dir, "index.html"), "hi");
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await server?.close();
  await tts?.close?.();
  server = tts = undefined;
});

/** How long the hub takes to pass a viewer's report on to the driver, sampled while the second sentence is being made. */
async function relayDelaysWhileSynthesising(engine: Tts): Promise<number[]> {
  tts = engine;
  server = await startServer({ staticDir: dir, speech: { tts: engine } });
  const viewer = await Client.join(server.wsUrl, "viewer");
  const driver = await Client.join(server.wsUrl, "driver");
  clients.push(viewer, driver);
  await Promise.all([viewer.next(), driver.next()]);
  driver.send(utterance({ utterance_id: "s", text: "First sentence. Second sentence." }));
  // the first sentence takes 2.1 s to make; once its audio is out, the second is being made
  await until(() => viewer.inbox.some((m) => m.type === "audio"), 15_000, "the first audio");
  const delays: number[] = [];
  for (let i = 0; i < 6; i++) {
    const id = `probe-${i}`;
    const sentAt = Date.now();
    viewer.send(make("speech_started", { utterance_id: id }));
    await until(() => driver.inbox.some((m) => m.utterance_id === id), 5000, `report ${id} to reach the driver`);
    delays.push(Date.now() - sentAt);
    await new Promise((r) => setTimeout(r, 120));
  }
  return delays;
}

describe("a slow engine and the hub", () => {
  it("keeps relaying promptly while an engine in a worker thread holds its own thread", async () => {
    const delays = await relayDelaysWhileSynthesising(await WorkerTts.create({ module: engineModule, options: OPTIONS }));
    expect(Math.max(...delays), `relay delays in ms: ${delays.join(", ")}`).toBeLessThan(300);
  }, 40_000);

  it("control: an engine that holds the process does stall the hub when it runs in it", async () => {
    const mod = (await import(engineModule.href)) as { create(o: unknown): Promise<Tts> };
    const delays = await relayDelaysWhileSynthesising(await mod.create(OPTIONS));
    expect(Math.max(...delays), `relay delays in ms: ${delays.join(", ")}`).toBeGreaterThan(300); // so this test can tell a stall from none
  }, 40_000);
});
