import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeTts } from "@vikaki/tts";
import { startServer, type RunningServer } from "../src/server.ts";
import { loadPersonas } from "../src/personas.ts";
import { Client, utterance } from "./helpers.ts";

let dir: string;
let server: RunningServer | undefined;
const clients: Client[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-personas-hub-"));
  await writeFile(join(dir, "index.html"), "hi");
  await writeFile(join(dir, "ada.vrm"), "ADA-BYTES");
  await writeFile(join(dir, "ben.vrm"), "BEN-BYTES");
  await writeFile(
    join(dir, "personas.yaml"),
    "personas:\n  ada:\n    avatar: ada.vrm\n    voice: af_heart\n    emotion: happy\n    style: warm\n  ben:\n    avatar: ben.vrm\n    voice: am_adam\n  quiet:\n    avatar: ada.vrm\n",
  );
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await server?.close();
  server = undefined;
});

async function setup(opts: { withPersonas?: boolean } = {}) {
  const fake = new FakeTts({ sampleRate: 16000, msPerChar: 5, chunkMs: 100 });
  const personas = opts.withPersonas === false ? undefined : await loadPersonas(join(dir, "personas.yaml"));
  server = await startServer({ staticDir: dir, personas, speech: { tts: fake } });
  const viewer = await Client.join(server.wsUrl, "viewer");
  clients.push(viewer);
  const driver = await Client.join(server.wsUrl, "driver");
  clients.push(driver);
  return { fake, viewer, driver, viewerWelcome: await viewer.next(), driverWelcome: await driver.next() };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("persona resolution", () => {
  it("tells clients which personas exist, in `welcome`", async () => {
    const { viewerWelcome, driverWelcome } = await setup();
    expect(viewerWelcome).toMatchObject({ type: "welcome", personas: ["ada", "ben", "quiet"] });
    expect(driverWelcome).toMatchObject({ personas: ["ada", "ben", "quiet"] });
  });

  it("refuses a line for an unknown persona with `unknown_persona`, says who exists, and speaks and shows nothing", async () => {
    const { driver, viewer, fake } = await setup();
    driver.send(utterance({ utterance_id: "u1", text: "Hello.", persona: "zed" }));
    const err = await driver.next();
    expect(err).toMatchObject({ type: "error", code: "unknown_persona", utterance_id: "u1" });
    expect(String(err.message)).toMatch(/zed/);
    expect(String(err.message)).toMatch(/ada, ben, quiet/);
    await viewer.quiet(300);
    expect(fake.requests).toEqual([]);
  });

  it("does not scold again for the rest of a streamed line it refused, and carries on with the next line", async () => {
    const { driver, viewer, fake } = await setup();
    driver.send(utterance({ utterance_id: "u1", text: undefined, delta: "Hello ", persona: "zed" }));
    expect(await driver.next()).toMatchObject({ code: "unknown_persona" });
    driver.send(utterance({ utterance_id: "u1", text: undefined, delta: "there.", final: true }));
    await driver.quiet(300);
    driver.send(utterance({ utterance_id: "u2", text: "Fine.", persona: "ben" }));
    await until(() => fake.requests.includes("Fine."));
    expect(viewer.inbox.some((m) => m.type === "utterance" && m.utterance_id === "u1")).toBe(false);
  });

  it("gives a line its persona's default emotion, unless the line names one", async () => {
    const { driver, viewer } = await setup();
    driver.send(utterance({ utterance_id: "u1", text: "One.", persona: "ada" }));
    expect(await viewer.next()).toMatchObject({ type: "utterance", utterance_id: "u1", emotion: "happy" });
    driver.send(utterance({ utterance_id: "u2", text: "Two.", persona: "ada", emotion: "sad" }));
    const second = await untilMsg(viewer, "u2");
    expect(second.emotion).toBe("sad");
    driver.send(utterance({ utterance_id: "u3", text: "Three.", persona: "quiet" }));
    expect((await untilMsg(viewer, "u3")).emotion).toBeUndefined(); // that persona has no default
  });

  it("speaks with the persona's voice, and with the engine's own when it names none", async () => {
    const { driver, fake } = await setup();
    driver.send(utterance({ utterance_id: "u1", text: "One.", persona: "ada" }));
    driver.send(utterance({ utterance_id: "u2", text: "Two.", persona: "ben" }));
    driver.send(utterance({ utterance_id: "u3", text: "Three.", persona: "quiet" }));
    driver.send(utterance({ utterance_id: "u4", text: "Four." }));
    await until(() => fake.requests.length === 4);
    expect(fake.voices).toEqual(["af_heart", "am_adam", undefined, undefined]);
  });

  it("without a personas file, passes any persona name through as before", async () => {
    const { driver, viewer, fake, driverWelcome } = await setup({ withPersonas: false });
    expect(driverWelcome).not.toHaveProperty("personas");
    driver.send(utterance({ utterance_id: "u1", text: "Hi.", persona: "anyone" }));
    expect(await viewer.next()).toMatchObject({ type: "utterance", persona: "anyone" });
    await until(() => fake.requests.length === 1);
    expect(fake.voices).toEqual(["anyone"]);
  });
});

async function untilMsg(c: Client, id: string) {
  for (let i = 0; i < 40; i++) {
    const m = await c.next();
    if (m.type === "utterance" && m.utterance_id === id) return m;
  }
  throw new Error(`no utterance ${id}`);
}

describe("persona files over HTTP", () => {
  it("lists personas and serves each one's avatar by name, and nothing else", async () => {
    await setup();
    const base = server!.url.replace(/\/avatar$/, "");
    const list = (await (await fetch(`${base}/avatar/personas.json`)).json()) as { name: string; avatarUrl: string; emotion?: string; style?: string }[];
    expect(list).toEqual([
      { name: "ada", avatarUrl: "/avatar/personas/ada.vrm", emotion: "happy", style: "warm", voice: "af_heart" },
      { name: "ben", avatarUrl: "/avatar/personas/ben.vrm", voice: "am_adam" },
      { name: "quiet", avatarUrl: "/avatar/personas/quiet.vrm" },
    ]);
    expect(JSON.stringify(list)).not.toContain(dir); // no filesystem paths leak
    const vrm = await fetch(`${base}/avatar/personas/ben.vrm`);
    expect(vrm.status).toBe(200);
    expect(await vrm.text()).toBe("BEN-BYTES");
    expect((await fetch(`${base}/avatar/personas/zed.vrm`)).status).toBe(404);
    expect((await fetch(`${base}/avatar/personas/..%2Fpersonas.yaml`)).status).toBe(404);
    expect((await fetch(`${base}/avatar/personas/ada.vrm%00`)).status).toBe(404);
  });

  it("has an empty list when there is no personas file", async () => {
    await setup({ withPersonas: false });
    const base = server!.url.replace(/\/avatar$/, "");
    expect(await (await fetch(`${base}/avatar/personas.json`)).json()).toEqual([]);
  });
});
