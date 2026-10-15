import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { make } from "@vikaki/protocol";
import { FakeTts } from "@vikaki/tts";
import { startServer, type RunningServer } from "../src/server.ts";
import { loadPersonas } from "../src/personas.ts";
import { Client, until, utterance } from "./helpers.ts";

let dir: string;
let server: RunningServer | undefined;
const clients: Client[] = [];
const track = <T extends Client>(c: T): T => (clients.push(c), c);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-seats-"));
  await writeFile(join(dir, "index.html"), "hi");
  await writeFile(join(dir, "a.vrm"), "A");
  await writeFile(join(dir, "personas.yaml"), "personas:\n  ada:\n    avatar: a.vrm\n    emotion: happy\n  ben:\n    avatar: a.vrm\n  cy:\n    avatar: a.vrm\n");
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await server?.close();
  server = undefined;
});

const fake = () => new FakeTts({ sampleRate: 16000, msPerChar: 5, chunkMs: 100 });
const seatDriver = async (url: string, ...seats: { seat_id: string; persona?: string }[]) => {
  const d = track(await Client.join(url, "driver", seats.length ? { seats } : {}));
  return { d, welcome: await d.next() };
};
const drain = async (c: Client, type: string, ms = 3000) => {
  await until(() => c.inbox.some((m) => m.type === type), ms, `${type}`);
  return c.inbox.filter((m) => m.type === type);
};

describe("one driver per seat", () => {
  it("lets drivers for different seats connect together, and refuses a second driver for a seat that has one", async () => {
    server = await startServer({ staticDir: dir });
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    expect(a.welcome).toMatchObject({ type: "welcome", role: "driver" });
    expect(b.welcome).toMatchObject({ type: "welcome", role: "driver" });
    const again = track(await Client.join(server.wsUrl, "driver", { seats: [{ seat_id: "B" }, { seat_id: "C" }] }));
    expect(await again.next()).toMatchObject({ type: "error", code: "driver_busy" });
    expect(await again.closed()).toBe(1008);
    expect(server.hub.hasDriver).toBe(true);
  });

  it("keeps the whole-table driver and seat drivers apart, either way round", async () => {
    server = await startServer({ staticDir: dir });
    const whole = await seatDriver(server.wsUrl);
    expect(whole.welcome).toMatchObject({ type: "welcome" });
    const seat = track(await Client.join(server.wsUrl, "driver", { seats: [{ seat_id: "A" }] }));
    expect(await seat.next()).toMatchObject({ type: "error", code: "driver_busy" });
    whole.d.close();
    await until(() => !server!.hub.hasDriver);
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    expect(a.welcome).toMatchObject({ type: "welcome" });
    const wholeAgain = track(await Client.join(server.wsUrl, "driver"));
    expect(await wholeAgain.next()).toMatchObject({ type: "error", code: "driver_busy" });
  });

  it("frees a seat when its driver leaves", async () => {
    server = await startServer({ staticDir: dir });
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    a.d.close();
    await until(() => !server!.hub.hasDriver);
    const next = await seatDriver(server.wsUrl, { seat_id: "A" });
    expect(next.welcome).toMatchObject({ type: "welcome" });
  });

  it("refuses seats from a viewer or a controller", async () => {
    server = await startServer({ staticDir: dir });
    for (const role of ["viewer", "controller"] as const) {
      const c = track(await Client.join(server.wsUrl, role, { seats: [{ seat_id: "A" }] }));
      expect(await c.next()).toMatchObject({ type: "error", code: "bad_message" });
    }
  });

  it("refuses a seat bound to a persona the hub does not have, when it has a personas file", async () => {
    server = await startServer({ staticDir: dir, personas: await loadPersonas(join(dir, "personas.yaml")) });
    const c = track(await Client.join(server.wsUrl, "driver", { seats: [{ seat_id: "A", persona: "nobody" }] }));
    expect(await c.next()).toMatchObject({ type: "error", code: "unknown_persona" });
    expect(server.hub.hasDriver).toBe(false);
  });
});

describe("what a seat driver may send", () => {
  it("is limited to its own seats", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    a.d.send(utterance({ seat_id: "B", utterance_id: "x1" }));
    expect(await a.d.next()).toMatchObject({ type: "error", code: "not_allowed" });
    a.d.send(make("turn_started", { seat_id: "B" }));
    expect(await a.d.next()).toMatchObject({ type: "error", code: "not_allowed" });
    a.d.send(make("game_over", { outcome: "won" })); // a table-wide event: not for a seat driver
    expect(await a.d.next()).toMatchObject({ type: "error", code: "not_allowed" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "ok1" }));
    a.d.send(make("game_over", { outcome: "won", seat_id: "A" }));
    await until(() => viewer.inbox.filter((m) => m.type === "game_over").length === 1);
    expect(viewer.inbox.map((m) => m.type)).toEqual(["utterance", "game_over"]); // nothing of seat B's reached the viewer
  });

  it("may send the table's state, which every viewer gets as it is (VIK-59)", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A", persona: "ada" });
    const state = make("table_state", { pot: 30, seats: [{ seat_id: "A", stack: 70 }, { seat_id: "B", stack: 100 }], turn: "B" });
    a.d.send(state);
    await until(() => viewer.inbox.length === 1);
    expect(viewer.inbox[0]).toEqual(state);
  });

  it("gets the seat's persona filled in on its lines and turns, unless it names another", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A", persona: "ada" }, { seat_id: "A2", persona: "ben" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "p1" }));
    a.d.send(make("turn_started", { seat_id: "A2" }));
    a.d.send(utterance({ seat_id: "A", utterance_id: "p2", persona: "cy" }));
    await until(() => viewer.inbox.length === 3);
    expect(viewer.inbox[0]).toMatchObject({ type: "utterance", utterance_id: "p1", persona: "ada" });
    expect(viewer.inbox[1]).toMatchObject({ type: "turn_started", seat_id: "A2", persona: "ben" });
    expect(viewer.inbox[2]).toMatchObject({ utterance_id: "p2", persona: "cy" });
  });

  it("cannot reuse a line id that another driver has in flight", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "same" }));
    await until(() => viewer.inbox.length === 1);
    b.d.send(utterance({ seat_id: "B", utterance_id: "same" }));
    expect(await b.d.next()).toMatchObject({ type: "error", code: "bad_message", utterance_id: "same" });
  });
});

describe("what each driver hears back", () => {
  it("is only the reports for its own lines", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "ua" }));
    b.d.send(utterance({ seat_id: "B", utterance_id: "ub" }));
    await until(() => viewer.inbox.length === 2);
    viewer.send(make("speech_started", { utterance_id: "ub", seat_id: "B" }));
    viewer.send(make("speech_finished", { utterance_id: "ub" }));
    viewer.send(make("speech_finished", { utterance_id: "ua" }));
    expect((await b.d.next()).utterance_id).toBe("ub");
    expect((await b.d.next()).type).toBe("speech_finished");
    expect(await a.d.next()).toMatchObject({ type: "speech_finished", utterance_id: "ua" });
    await a.d.quiet();
    await b.d.quiet();
  });

  it("includes what the hub itself reports, such as an unknown persona on a line", async () => {
    server = await startServer({ staticDir: dir, personas: await loadPersonas(join(dir, "personas.yaml")) });
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "bad", persona: "nobody" }));
    expect(await a.d.next()).toMatchObject({ type: "error", code: "unknown_persona", utterance_id: "bad" });
    await b.d.quiet();
  });
});

describe("cancel with several drivers", () => {
  it("from a seat driver without an id stops only its own lines; a controller stops them all", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "ua" }));
    b.d.send(utterance({ seat_id: "B", utterance_id: "ub" }));
    await until(() => viewer.inbox.length === 2);
    viewer.inbox.length = 0;
    a.d.send(make("cancel", {}));
    await until(() => viewer.inbox.length === 1);
    expect(viewer.inbox[0]).toMatchObject({ type: "cancel", utterance_id: "ua" });
    a.d.send(make("cancel", { utterance_id: "ub" })); // another seat's line
    expect(await a.d.next()).toMatchObject({ type: "error", code: "not_allowed" });
    const ctl = track(await Client.join(server.wsUrl, "controller"));
    await ctl.next();
    viewer.inbox.length = 0;
    ctl.send(make("cancel", {}));
    await until(() => viewer.inbox.length >= 1);
    expect(viewer.inbox.map((m) => [m.type, m.utterance_id])).toEqual([["cancel", "ub"]]); // "ua" was already cancelled by its own driver
  });

  it("when a seat driver leaves, only its lines are stopped and the other seat goes on speaking", async () => {
    const tts = fake();
    server = await startServer({ staticDir: dir, speech: { tts } });
    // No page is open, so the hub keeps time itself and reports `speech_started` / `speech_finished` to each line's own driver.
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    const long = "This is a line long enough that it is still being spoken when the driver goes. ".repeat(6);
    a.d.send(utterance({ seat_id: "A", utterance_id: "ua", text: long }));
    b.d.send(utterance({ seat_id: "B", utterance_id: "ub", text: "Short." }));
    await drain(a.d, "speech_started");
    a.d.close();
    const finished = await drain(b.d, "speech_finished");
    expect(finished[0]).toMatchObject({ utterance_id: "ub" });
    expect(b.d.inbox.some((m) => m.type === "speech_interrupted")).toBe(false);
  });
});
