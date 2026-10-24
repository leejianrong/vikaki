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

  it("may react silently for its own seats only, and the seat's persona is filled in (VIK-58)", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A", persona: "ada" });
    a.d.send(make("react", { seat_id: "B", emotion: "happy" }));
    expect(await a.d.next()).toMatchObject({ type: "error", code: "not_allowed" });
    a.d.send(make("react", { seat_id: "A", emotion: "surprised", gesture: "shake" }));
    await until(() => viewer.inbox.length === 1);
    expect(viewer.inbox[0]).toMatchObject({ type: "react", seat_id: "A", persona: "ada", emotion: "surprised", gesture: "shake" });
  });

  it("relays a private thought to the viewers only, for its own seat, never to another driver and never as speech (VIK-93)", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A", persona: "ada" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B", persona: "ben" });
    a.d.send(make("thought", { seat_id: "B", text: "Not my seat." }));
    expect(await a.d.next()).toMatchObject({ type: "error", code: "not_allowed" });
    a.d.send(make("thought", { seat_id: "A", text: "Ace-king. Raise." }));
    a.d.send(utterance({ seat_id: "A", utterance_id: "after" })); // a later message, so the viewer has seen everything sent
    await until(() => viewer.inbox.length === 2);
    expect(viewer.inbox[0]).toMatchObject({ type: "thought", seat_id: "A", persona: "ada", text: "Ace-king. Raise." });
    expect([...a.d.inbox, ...b.d.inbox].some((m) => m.type === "thought")).toBe(false);
  });

  it("relays a human's speech from the page to the driver of that seat only, whole-table driver included (VIK-69)", async () => {
    server = await startServer({ staticDir: dir });
    const page = track(await Client.join(server.wsUrl, "viewer"));
    await page.next();
    const other = track(await Client.join(server.wsUrl, "viewer"));
    await other.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A", persona: "ada" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B", persona: "ben" });
    page.send(make("human_utterance", { seat_id: "B", text: "Ocean", final: true }));
    page.send(make("human_utterance", { seat_id: "A", text: "Tide" }));
    await until(() => a.d.inbox.some((m) => m.type === "human_utterance") && b.d.inbox.some((m) => m.type === "human_utterance"));
    expect(b.d.inbox.filter((m) => m.type === "human_utterance")).toMatchObject([{ seat_id: "B", text: "Ocean", final: true }]);
    expect(a.d.inbox.filter((m) => m.type === "human_utterance")).toMatchObject([{ seat_id: "A", text: "Tide" }]);
    expect(other.inbox.some((m) => m.type === "human_utterance")).toBe(false); // a transcript goes to the game, not round the viewers
    // a seat nobody drives: dropped quietly, the page is not told off
    page.send(make("human_utterance", { seat_id: "Z", text: "Hello?" }));
    page.send(make("human_utterance", { seat_id: "A", text: "later" }));
    await until(() => a.d.inbox.filter((m) => m.type === "human_utterance").length === 2);
    expect(page.inbox.some((m) => m.type === "error")).toBe(false);
  });

  it("hands a viewer's pause, play or step to every driver, and a driver's transport state to the viewers (VIK-135)", async () => {
    server = await startServer({ staticDir: dir });
    const page = track(await Client.join(server.wsUrl, "viewer"));
    await page.next();
    const other = track(await Client.join(server.wsUrl, "viewer"));
    await other.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A", persona: "ada" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B", persona: "ben" });
    page.send(make("transport", { action: "pause" }));
    await until(() => a.d.inbox.some((m) => m.type === "transport") && b.d.inbox.some((m) => m.type === "transport"));
    expect(a.d.inbox.find((m) => m.type === "transport")).toMatchObject({ action: "pause" });
    expect(other.inbox.some((m) => m.type === "transport")).toBe(false); // for the game, not for the other pages
    a.d.send(make("transport_state", { paused: true }));
    await until(() => other.inbox.some((m) => m.type === "transport_state"));
    expect(other.inbox.find((m) => m.type === "transport_state")).toMatchObject({ paused: true });
    expect(page.inbox.some((m) => m.type === "error")).toBe(false);
  });

  it("passes a viewer's buy-back request to every driver only while the table asks for them (VIK-108)", async () => {
    server = await startServer({ staticDir: dir });
    const page = track(await Client.join(server.wsUrl, "viewer"));
    await page.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A", persona: "ada" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B", persona: "ben" });
    const asked = (d: typeof a) => d.d.inbox.filter((m) => m.type === "audience_request").length;
    // Messages on two connections have no order between them, so wait for the page to hear each state before it asks.
    let states = 0;
    const table = async (rebuy?: "ask" | "auto" | "never") => {
      a.d.send(make("table_state", { seats: [{ seat_id: "A", stack: 0 }], ...(rebuy ? { rebuy } : {}) }));
      const want = ++states;
      await until(() => page.inbox.filter((m) => m.type === "table_state").length === want);
    };
    for (const policy of ["never", "auto", undefined] as const) {
      await table(policy);
      page.send(make("audience_request", { kind: "rebuy", seat_id: "A" }));
    }
    await table("ask");
    page.send(make("audience_request", { kind: "rebuy", seat_id: "A" }));
    await until(() => asked(a) === 1 && asked(b) === 1);
    expect(a.d.inbox.find((m) => m.type === "audience_request")).toMatchObject({ kind: "rebuy", seat_id: "A" });
    await table("never"); // the table stops asking
    page.send(make("audience_request", { kind: "rebuy", seat_id: "A" }));
    await table("ask");
    page.send(make("audience_request", { kind: "rebuy", seat_id: "B" }));
    await until(() => a.d.inbox.some((m) => m.type === "audience_request" && m.seat_id === "B"));
    expect(asked(a), "only the two sent while the table asked").toBe(2);
    expect(page.inbox.some((m) => m.type === "error")).toBe(false);
  });

  it("gives a whole-table driver the human's speech for any seat", async () => {
    server = await startServer({ staticDir: dir });
    const page = track(await Client.join(server.wsUrl, "viewer"));
    await page.next();
    const whole = await seatDriver(server.wsUrl);
    page.send(make("human_utterance", { seat_id: "Q", text: "Guess: 40" }));
    await until(() => whole.d.inbox.some((m) => m.type === "human_utterance"));
    expect(whole.d.inbox.find((m) => m.type === "human_utterance")).toMatchObject({ seat_id: "Q", text: "Guess: 40" });
  });

  it("refuses a human's speech from a driver or a controller (only the page that has the microphone sends it)", async () => {
    server = await startServer({ staticDir: dir });
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    a.d.send(make("human_utterance", { seat_id: "A", text: "x" }));
    expect(await a.d.next()).toMatchObject({ type: "error", code: "not_allowed" });
    const ctl = track(await Client.join(server.wsUrl, "controller"));
    await ctl.next();
    ctl.send(make("human_utterance", { seat_id: "A", text: "x" }));
    expect(await ctl.next()).toMatchObject({ type: "error", code: "not_allowed" });
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

  it("a seat driver that cancels its own line still hears how it ended: the page's speech_interrupted reaches it, and the other seat's driver hears nothing (VIK-71)", async () => {
    server = await startServer({ staticDir: dir });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "ua" }));
    await until(() => viewer.inbox.some((m) => m.type === "utterance"));
    a.d.send(make("cancel", { utterance_id: "ua" }));
    await until(() => viewer.inbox.some((m) => m.type === "cancel"));
    // the page was playing it and reports the interruption, as a page does: with the line's id and nothing else
    viewer.send(make("speech_interrupted", { utterance_id: "ua", reason: "cancelled" }));
    expect(await a.d.next()).toMatchObject({ type: "speech_interrupted", utterance_id: "ua", reason: "cancelled" });
    await new Promise((r) => setTimeout(r, 150));
    expect(b.d.inbox).toEqual([]);
  });

  it("a seat driver that cancels a line still being synthesised hears the hub's answer; the other seat's driver does not (VIK-71)", async () => {
    server = await startServer({ staticDir: dir, speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 5, firstChunkDelayMs: 3000 }) } });
    const viewer = track(await Client.join(server.wsUrl, "viewer"));
    await viewer.next();
    const a = await seatDriver(server.wsUrl, { seat_id: "A" });
    const b = await seatDriver(server.wsUrl, { seat_id: "B" });
    a.d.send(utterance({ seat_id: "A", utterance_id: "ua", text: "Slow to start." }));
    await until(() => viewer.inbox.some((m) => m.type === "utterance"));
    a.d.send(make("cancel", { utterance_id: "ua" }));
    expect(await a.d.next()).toMatchObject({ type: "speech_interrupted", utterance_id: "ua", reason: "cancelled" });
    await new Promise((r) => setTimeout(r, 150));
    expect(b.d.inbox).toEqual([]);
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
