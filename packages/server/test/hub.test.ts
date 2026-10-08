import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";
import { Client, until, utterance } from "./helpers.ts";
import { startServer, type HubEvent, type RunningServer } from "../src/server.ts";

let dir: string;
let server: RunningServer | undefined;
const clients: Client[] = [];
const track = <T extends Client>(c: T): T => (clients.push(c), c);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-hub-"));
  await writeFile(join(dir, "index.html"), "hi");
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await server?.close();
  server = undefined;
});

describe("joining", () => {
  it("welcomes a viewer and a driver and echoes the session id", async () => {
    server = await startServer({ staticDir: dir });
    const v = track(await Client.join(server.wsUrl, "viewer", { session_id: "match-7" }));
    expect(await v.next()).toMatchObject({ type: "welcome", role: "viewer", session_id: "match-7" });
    const d = track(await Client.join(server.wsUrl, "driver"));
    expect(await d.next()).toMatchObject({ type: "welcome", role: "driver" });
    expect(server.hub.hasDriver).toBe(true);
    expect(server.hub.viewerCount).toBe(1);
  });

  it("closes a client whose first message is not hello", async () => {
    server = await startServer({ staticDir: dir });
    const c = track(await Client.open(server.wsUrl));
    c.send(utterance());
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_message" });
    expect(await c.closed()).toBe(1008);
  });

  it("closes a client that never says hello", async () => {
    server = await startServer({ staticDir: dir, hub: { helloTimeoutMs: 100 } });
    const c = track(await Client.open(server.wsUrl));
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_message" });
    expect(await c.closed()).toBe(1008);
  });

  it("rejects an unsupported protocol version with a clear error and closes", async () => {
    server = await startServer({ staticDir: dir });
    const c = track(await Client.open(server.wsUrl));
    c.send({ protocol_version: 99, type: "hello", role: "viewer" });
    const err = await c.next();
    expect(err).toMatchObject({ type: "error", code: "unsupported_protocol_version" });
    expect(String(err.message)).toContain("protocol_version 1");
    expect(await c.closed()).toBe(1008);
  });

  it("rejects non-JSON before hello", async () => {
    server = await startServer({ staticDir: dir });
    const c = track(await Client.open(server.wsUrl));
    c.send("this is not json");
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_message" });
    expect(await c.closed()).toBe(1008);
  });
});

describe("one driver at a time", () => {
  it("refuses a second driver with driver_busy and leaves the first untouched", async () => {
    server = await startServer({ staticDir: dir });
    const first = track(await Client.join(server.wsUrl, "driver"));
    await first.next();
    const second = track(await Client.join(server.wsUrl, "driver"));
    expect(await second.next()).toMatchObject({ type: "error", code: "driver_busy" });
    expect(await second.closed()).toBe(1008);
    // The first driver still works.
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    first.send(utterance());
    expect(await viewer.next()).toMatchObject({ type: "utterance", utterance_id: "u1" });
  });

  it("frees the slot when the driver disconnects", async () => {
    server = await startServer({ staticDir: dir });
    const first = track(await Client.join(server.wsUrl, "driver"));
    await first.next();
    first.close();
    await first.closed();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.hub.hasDriver).toBe(false);
    const second = track(await Client.join(server.wsUrl, "driver"));
    expect(await second.next()).toMatchObject({ type: "welcome" });
  });
});

describe("relaying", () => {
  it("sends the driver's messages to every viewer unchanged, and not back to the driver", async () => {
    server = await startServer({ staticDir: dir });
    const v1 = track(await Client.join(server.wsUrl, "viewer"));
    const v2 = track(await Client.join(server.wsUrl, "viewer"));
    const d = track(await Client.join(server.wsUrl, "driver"));
    await Promise.all([v1.next(), v2.next(), d.next()]);
    const sent = utterance({ emotion: "smug", intensity: 0.7, persona: "ada", kind: "banter" });
    d.send(sent);
    expect(await v1.next()).toEqual(sent);
    expect(await v2.next()).toEqual(sent);
    await d.quiet();
  });

  it("tells the driver once when several viewers report the same thing", async () => {
    server = await startServer({ staticDir: dir });
    const v1 = track(await Client.join(server.wsUrl, "viewer"));
    const v2 = track(await Client.join(server.wsUrl, "viewer"));
    const d = track(await Client.join(server.wsUrl, "driver"));
    await Promise.all([v1.next(), v2.next(), d.next()]);
    const started = make("speech_started", { utterance_id: "u1", seat_id: "seat-1" });
    v1.send(started);
    v2.send(started);
    expect(await d.next()).toEqual(started);
    await d.quiet();
    // A different utterance still gets through.
    v2.send(make("speech_finished", { utterance_id: "u1" }));
    expect(await d.next()).toMatchObject({ type: "speech_finished" });
  });
});

describe("a new driver session", () => {
  it("hears reports for an utterance id that an earlier driver session used (a reloaded page starts again at demo-1)", async () => {
    server = await startServer({ staticDir: dir });
    const v = track(await Client.join(server.wsUrl, "viewer"));
    const d1 = track(await Client.join(server.wsUrl, "driver"));
    await Promise.all([v.next(), d1.next()]);
    v.send(make("speech_started", { utterance_id: "demo-1" }));
    expect(await d1.next()).toMatchObject({ type: "speech_started" });
    d1.ws.close();
    await until(() => server!.hub.hasDriver === false, 3000, "the first driver to leave");

    const d2 = track(await Client.join(server.wsUrl, "driver"));
    await d2.next();
    v.send(make("speech_started", { utterance_id: "demo-1" }));
    expect(await d2.next()).toMatchObject({ type: "speech_started", utterance_id: "demo-1" });
  });
});

describe("who may send what", () => {
  it("stops a viewer sending utterances, and keeps the connection", async () => {
    server = await startServer({ staticDir: dir });
    const v = track(await Client.join(server.wsUrl, "viewer"));
    const d = track(await Client.join(server.wsUrl, "driver"));
    await Promise.all([v.next(), d.next()]);
    v.send(utterance());
    expect(await v.next()).toMatchObject({ type: "error", code: "not_allowed" });
    await d.quiet();
    v.send(make("speech_started", { utterance_id: "u9" }));
    expect(await d.next()).toMatchObject({ type: "speech_started" });
  });

  it("stops a driver claiming speech events", async () => {
    server = await startServer({ staticDir: dir });
    const d = track(await Client.join(server.wsUrl, "driver"));
    await d.next();
    d.send(make("speech_finished", { utterance_id: "u1" }));
    expect(await d.next()).toMatchObject({ type: "error", code: "not_allowed" });
  });

  it("answers a bad message with an error but stays usable", async () => {
    server = await startServer({ staticDir: dir });
    const v = track(await Client.join(server.wsUrl, "viewer"));
    const d = track(await Client.join(server.wsUrl, "driver"));
    await Promise.all([v.next(), d.next()]);
    d.send(utterance({ text: undefined, delta: undefined }));
    expect(await d.next()).toMatchObject({ type: "error", code: "bad_message" });
    d.send(utterance());
    expect(await v.next()).toMatchObject({ type: "utterance" });
  });

  it("rejects a second hello", async () => {
    server = await startServer({ staticDir: dir });
    const v = track(await Client.join(server.wsUrl, "viewer"));
    await v.next();
    v.send({ protocol_version: PROTOCOL_VERSION, type: "hello", role: "driver" });
    expect(await v.next()).toMatchObject({ type: "error", code: "bad_message" });
    expect(server.hub.hasDriver).toBe(false);
  });

  it("closes a connection that sends an oversized message", async () => {
    server = await startServer({ staticDir: dir });
    const v = track(await Client.join(server.wsUrl, "viewer"));
    await v.next();
    v.send("x".repeat(300 * 1024));
    expect(await v.closed()).toBe(1009);
  });
});

describe("driver token", () => {
  it("refuses a driver without the right token, and lets viewers in freely", async () => {
    server = await startServer({ staticDir: dir, hub: { token: "s3cret" } });
    const none = track(await Client.join(server.wsUrl, "driver"));
    expect(await none.next()).toMatchObject({ type: "error", code: "unauthorized" });
    expect(await none.closed()).toBe(1008);
    const wrong = track(await Client.join(server.wsUrl, "driver", { token: "nope" }));
    expect(await wrong.next()).toMatchObject({ type: "error", code: "unauthorized" });
    const right = track(await Client.join(server.wsUrl, "driver", { token: "s3cret" }));
    expect(await right.next()).toMatchObject({ type: "welcome", role: "driver" });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    expect(await viewer.next()).toMatchObject({ type: "welcome", role: "viewer" });
  });

  it("does not let a failed token attempt take the driver slot", async () => {
    server = await startServer({ staticDir: dir, hub: { token: "s3cret" } });
    const bad = track(await Client.join(server.wsUrl, "driver", { token: "nope" }));
    await bad.next();
    expect(server.hub.hasDriver).toBe(false);
  });
});

describe("other websites cannot use the hub", () => {
  it("refuses a browser origin from another site", async () => {
    server = await startServer({ staticDir: dir });
    await expect(Client.open(server.wsUrl, { Origin: "https://evil.example" })).rejects.toMatchObject({ status: 403 });
  });

  it("accepts the hub's own page, no origin (CLI), and an explicitly allowed origin", async () => {
    server = await startServer({ staticDir: dir, hub: { allowedOrigins: ["https://meet.google.com"] } });
    track(await Client.open(server.wsUrl, { Origin: `http://127.0.0.1:${server.port}` }));
    track(await Client.open(server.wsUrl));
    track(await Client.open(server.wsUrl, { Origin: "https://meet.google.com" }));
  });

  it("refuses a Host header that is not a local name (DNS rebinding)", async () => {
    server = await startServer({ staticDir: dir });
    await expect(Client.open(server.wsUrl, { Host: "evil.example" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("event log hook", () => {
  it("reports every accepted and hub-sent message in order, with direction", async () => {
    const events: HubEvent[] = [];
    server = await startServer({ staticDir: dir, hub: { onEvent: (e) => events.push(e) } });
    const v = track(await Client.join(server.wsUrl, "viewer"));
    const d = track(await Client.join(server.wsUrl, "driver"));
    await Promise.all([v.next(), d.next()]);
    d.send(utterance());
    await v.next();
    v.send(make("speech_started", { utterance_id: "u1" }));
    await d.next();
    server.hub.toDriver(make("error", { code: "tts_failed", message: "voice engine unavailable", utterance_id: "u1" }));
    await d.next();
    expect(events.map((e) => `${e.from}->${e.to}:${e.message.type}`)).toEqual([
      "driver->viewers:utterance",
      "viewer->driver:speech_started",
      "hub->driver:error",
    ]);
    expect(events.every((e, i) => i === 0 || e.at >= events[i - 1]!.at)).toBe(true);
  });
});

describe("emotions", () => {
  it("passes an unknown emotion through with a logged warning, not an error", async () => {
    const warnings: string[] = [];
    server = await startServer({ staticDir: dir, hub: { warn: (m) => warnings.push(m) } });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const driver = track(await Client.join(server.wsUrl, "driver"));
    await driver.next();
    driver.send(utterance({ utterance_id: "u1", text: "Hi.", emotion: "blorp" }));
    expect(await viewer.next()).toMatchObject({ type: "utterance", emotion: "blorp" }); // the page decides; it shows neutral
    await driver.quiet(200); // no error for the driver
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/blorp/);
  });

  it("does not warn for the seven known emotions or none", async () => {
    const warnings: string[] = [];
    server = await startServer({ staticDir: dir, hub: { warn: (m) => warnings.push(m) } });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const driver = track(await Client.join(server.wsUrl, "driver"));
    await driver.next();
    for (const emotion of [undefined, "neutral", "happy", "smug", "worried", "surprised", "sad", "angry"]) {
      driver.send(utterance({ utterance_id: `u-${emotion}`, text: "Hi.", ...(emotion ? { emotion } : {}) }));
      await viewer.next();
    }
    expect(warnings).toEqual([]);
  });
});
