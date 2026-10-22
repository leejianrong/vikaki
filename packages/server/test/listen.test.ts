import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { make } from "@vikaki/protocol";
import { FakeTts, type SynthesisRequest } from "@vikaki/tts";
import { startServer, type RunningServer } from "../src/server.ts";
import { Client } from "./helpers.ts";

// Listening in to private thoughts (VIK-98): only the thoughts of the seat being listened to are voiced; the rest reach the page as text.
type Msg = Record<string, unknown>;

let dir: string;
let server: RunningServer | undefined;
const clients: Client[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-listen-"));
  await writeFile(join(dir, "index.html"), "hi");
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await server?.close();
  server = undefined;
});

async function setup() {
  const asked: string[] = [];
  const fake = new FakeTts({ sampleRate: 16000, msPerChar: 20, chunkMs: 100 });
  const tts = { name: "spy", synthesize: (r: SynthesisRequest) => (asked.push(r.text), fake.synthesize(r)) };
  server = await startServer({ staticDir: dir, speech: { tts } });
  const viewer = await Client.join(server.wsUrl, "viewer");
  clients.push(viewer);
  await viewer.next();
  const driver = await Client.join(server.wsUrl, "driver");
  clients.push(driver);
  await driver.next();
  return { asked, viewer, driver, server: server! };
}

const think = (driver: Client, id: string, seat: string, text: string) => driver.ws.send(JSON.stringify(make("utterance", { utterance_id: id, seat_id: seat, text, thought: true })));
const listen = (viewer: Client, mode: "seat" | "all" | "off", seat?: string) => viewer.ws.send(JSON.stringify(make("listen", { mode, ...(seat ? { seat_id: seat } : {}) })));

async function readUntil(c: Client, stop: (m: Msg) => boolean, ms = 4000): Promise<Msg[]> {
  const out: Msg[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = await c.next();
    out.push(m);
    if (stop(m)) return out;
  }
  throw new Error(`timed out; got ${out.map((m) => m.type).join(",")}`);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("listen", () => {
  it("voices every seat's thoughts until told otherwise, as before", async () => {
    const { viewer, driver, asked } = await setup();
    think(driver, "t1", "seat-1", "Please hold.");
    const got = await readUntil(viewer, (m) => m.type === "audio" && m.final === true);
    expect(got.some((m) => m.type === "audio" && m.utterance_id === "t1")).toBe(true);
    expect(asked).toEqual(["Please hold."]);
  });

  it("does not synthesise a thought nobody listens to, still sends its text, and still tells the driver it was said", async () => {
    const { viewer, driver, asked } = await setup();
    listen(viewer, "off");
    expect(await viewer.next()).toMatchObject({ type: "listen_state", mode: "off" });
    think(driver, "t1", "seat-1", "Nobody hears this.");
    const got = await readUntil(viewer, (m) => m.type === "utterance");
    expect(got.at(-1)).toMatchObject({ type: "utterance", thought: true, text: "Nobody hears this." });
    await readUntilDriver(driver, "t1");
    await wait(50);
    expect(asked).toEqual([]);
  });

  it("voices only the seat listened to, and silences the others", async () => {
    const { viewer, driver, asked } = await setup();
    listen(viewer, "seat", "seat-2");
    expect(await viewer.next()).toMatchObject({ type: "listen_state", mode: "seat", seat_id: "seat-2" });
    think(driver, "a", "seat-1", "Seat one thinks.");
    think(driver, "b", "seat-2", "Seat two thinks.");
    await readUntil(viewer, (m) => m.type === "audio" && m.utterance_id === "b" && m.final === true);
    expect(asked).toEqual(["Seat two thinks."]);
  });

  it("stops the thought in progress when another seat is chosen", async () => {
    const { viewer, driver } = await setup();
    think(driver, "long", "seat-1", "A long thought that goes on and on and on and on and on and on.");
    await readUntil(viewer, (m) => m.type === "audio" && m.utterance_id === "long");
    listen(viewer, "seat", "seat-2");
    const got = await readUntil(viewer, (m) => m.type === "cancel");
    expect(got.at(-1)).toMatchObject({ type: "cancel", utterance_id: "long" });
  });

  it("speaks a seat's latest thought when it is chosen, to the page only", async () => {
    const { viewer, driver, asked } = await setup();
    listen(viewer, "off");
    await viewer.next();
    think(driver, "t1", "seat-2", "I had a flush all along.");
    await readUntil(viewer, (m) => m.type === "utterance");
    await readUntilDriver(driver, "t1");
    listen(viewer, "seat", "seat-2");
    const got = await readUntil(viewer, (m) => m.type === "audio" && String(m.utterance_id).startsWith("listen-") && m.final === true);
    expect(got.find((m) => m.type === "utterance")).toMatchObject({ thought: true, text: "I had a flush all along.", seat_id: "seat-2" });
    expect(asked).toEqual(["I had a flush all along."]);
    // the game never sent that line, so it hears nothing about it
    await wait(100);
    const late = await Promise.race([driver.next().then((m) => m), wait(150).then(() => undefined)]);
    expect(late).toBeUndefined();
  });

  it("tells a page that joins later who is being listened to", async () => {
    const { viewer } = await setup();
    listen(viewer, "seat", "seat-3");
    await viewer.next();
    const late = await Client.join(server!.wsUrl, "viewer");
    clients.push(late);
    await late.next(); // welcome
    expect(await late.next()).toMatchObject({ type: "listen_state", mode: "seat", seat_id: "seat-3" });
  });

  it("refuses a seat mode without a seat, and a driver sending listen", async () => {
    const { viewer, driver } = await setup();
    viewer.ws.send(JSON.stringify({ protocol_version: 1, type: "listen", mode: "seat" }));
    expect(await viewer.next()).toMatchObject({ type: "error", code: "bad_message" });
    driver.ws.send(JSON.stringify(make("listen", { mode: "off" })));
    expect(await driver.next()).toMatchObject({ type: "error", code: "not_allowed" });
  });
});

async function readUntilDriver(driver: Client, id: string): Promise<void> {
  await readUntil(driver, (m) => m.type === "speech_finished" && m.utterance_id === id);
}
