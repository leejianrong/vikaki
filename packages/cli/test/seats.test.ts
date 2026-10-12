import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { say, type Io } from "../src/commands.ts";
import { DriverSession } from "../src/driver-session.ts";
import { createMcpServer } from "../src/mcp.ts";
import { playHand } from "../src/table-demo.ts";

let dir: string;
let servers: RunningServer[] = [];
const toClose: (() => Promise<void>)[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-cli-seats-"));
  await writeFile(join(dir, "index.html"), "hi");
  await writeFile(join(dir, "a.vrm"), "x");
  await writeFile(join(dir, "personas.yaml"), "personas:\n  ada:\n    avatar: a.vrm\n  ben:\n    avatar: a.vrm\n  cy:\n    avatar: a.vrm\n");
});
afterEach(async () => {
  await Promise.all(toClose.splice(0).map((f) => f()));
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

/** What the hub relayed to viewers, in order. No page is open, so the hub keeps time itself and reports each line to its driver. */
type Seen = Record<string, unknown>[];
async function hub(opts: { personas?: boolean; msPerChar?: number } = {}) {
  const seen: Seen = [];
  const s = await startServer({
    staticDir: dir,
    personas: opts.personas === false ? undefined : await loadPersonas(join(dir, "personas.yaml")),
    hub: { onEvent: (e) => e.to === "viewers" && seen.push(e.message as unknown as Record<string, unknown>) },
    speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: opts.msPerChar ?? 5, chunkMs: 100 }) },
  });
  servers.push(s);
  return Object.assign(s, { seen });
}

const watcher = (s: { seen: Seen }) => ({ seen: s.seen, utterances: () => s.seen.filter((m) => m.type === "utterance") });

const session = (url: string, seats?: { seat_id: string; persona?: string }[]) => {
  const s = new DriverSession({ url }, seats);
  toClose.push(() => s.close());
  return s;
};

const quiet = () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) };
  return { io, out, err };
};

describe("DriverSession for seats", () => {
  it("two sessions for different seats are connected at once; one for the whole table is refused beside them", async () => {
    const s = await hub();
    const a = session(s.wsUrl, [{ seat_id: "A", persona: "ada" }]);
    const b = session(s.wsUrl, [{ seat_id: "B", persona: "ben" }]);
    expect((await a.say({ text: "one" })).outcome).toBe("completed");
    expect((await b.say({ text: "two" })).outcome).toBe("completed");
    const whole = session(s.wsUrl);
    await expect(whole.say({ text: "three" })).rejects.toMatchObject({ code: "driver_busy" });
  });

  it("speaks for its only seat without being told which, and the hub fills in the seat's persona", async () => {
    const s = await hub();
    const w = watcher(s);
    await session(s.wsUrl, [{ seat_id: "A", persona: "ada" }]).say({ text: "hello" });
    expect(w.utterances()[0]).toMatchObject({ seat_id: "A", persona: "ada" });
  });

  it("with several seats, wants to be told which, and refuses a seat that is not its own, before sending anything", async () => {
    const s = await hub();
    const w = watcher(s);
    const both = session(s.wsUrl, [{ seat_id: "A" }, { seat_id: "B" }]);
    await expect(both.say({ text: "who?" })).rejects.toThrow(/several seats.*A, B/);
    await expect(both.say({ text: "x", seat: "C" })).rejects.toThrow(/not one of this server's seats.*A, B/);
    expect((await both.say({ text: "ok", seat: "B" })).outcome).toBe("completed");
    expect(w.utterances().map((m) => m.seat_id)).toEqual(["B"]);
  });

  it("on the whole table, names the seat of a line when asked, and keeps emotion and persona per seat", async () => {
    const s = await hub();
    const w = watcher(s);
    const t = session(s.wsUrl);
    t.setEmotion("smug", "north");
    t.setEmotion("sad", "south");
    await t.setPersona("ada", "north");
    await t.say({ text: "a", seat: "north" });
    await t.say({ text: "b", seat: "south" });
    await t.say({ text: "c" }); // no seat: the old default, with no seat's feelings
    expect(w.utterances().map((m) => [m.seat_id, m.emotion, m.persona])).toEqual([
      ["north", "smug", "ada"],
      ["south", "sad", undefined],
      ["mcp", undefined, undefined],
    ]);
  });
});

describe("the MCP tools", () => {
  async function mcp(url: string, seats?: { seat_id: string; persona?: string }[]) {
    const ds = session(url, seats);
    const server = createMcpServer(ds);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    toClose.push(() => client.close());
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: r.isError === true, body: r.content[0]!.text, json: () => JSON.parse(r.content[0]!.text) as Record<string, unknown> };
    };
    return { call, client };
  }

  it("say, set_emotion and set_persona take an optional seat", async () => {
    const s = await hub();
    const w = watcher(s);
    const { call, client } = await mcp(s.wsUrl);
    const tools = (await client.listTools()).tools;
    for (const name of ["say", "set_emotion", "set_persona"]) {
      expect(Object.keys((tools.find((t) => t.name === name)!.inputSchema as { properties: object }).properties), name).toContain("seat");
    }
    expect((await call("set_emotion", { emotion: "angry", seat: "north" })).json()).toMatchObject({ emotion: "angry", seat: "north" });
    expect((await call("set_persona", { persona: "ben", seat: "south" })).json()).toMatchObject({ persona: "ben" });
    expect((await call("say", { text: "hi", seat: "north" })).json()).toMatchObject({ outcome: "completed" });
    expect((await call("say", { text: "yo", seat: "south" })).isError).toBe(false);
    expect(w.utterances().map((m) => [m.seat_id, m.emotion, m.persona])).toEqual([["north", "angry", undefined], ["south", undefined, "ben"]]);
  });

  it("a server bound to a seat speaks as that seat, and says so plainly when asked for another", async () => {
    const s = await hub();
    const w = watcher(s);
    const { call } = await mcp(s.wsUrl, [{ seat_id: "seat-2", persona: "ben" }]);
    expect((await call("say", { text: "my line" })).isError).toBe(false);
    const wrong = await call("say", { text: "not mine", seat: "seat-1" });
    expect(wrong.isError).toBe(true);
    expect(wrong.body).toMatch(/not one of this server's seats/);
    expect(w.utterances().map((m) => [m.seat_id, m.persona])).toEqual([["seat-2", "ben"]]);
  });

  it("tells a model, when another driver holds the seat, whose it is", async () => {
    const s = await hub();
    const { call: first } = await mcp(s.wsUrl, [{ seat_id: "seat-1" }]);
    await first("say", { text: "taken" });
    const { call: second } = await mcp(s.wsUrl, [{ seat_id: "seat-1" }]);
    const r = await second("say", { text: "mine?" });
    expect(r.isError).toBe(true);
    expect(r.body).toMatch(/seat/);
  });
});

describe("vikaki say --seat", () => {
  it("claims the seat, so two says for different seats can run together and a third for a taken seat is refused", { timeout: 30_000 }, async () => {
    const s = await hub({ msPerChar: 30 });
    const a = quiet();
    const b = quiet();
    const [ra, rb] = await Promise.all([
      say({ url: s.wsUrl, text: "x".repeat(40), seat: "A" }, a.io),
      say({ url: s.wsUrl, text: "y".repeat(40), seat: "B" }, b.io),
    ]);
    expect([ra, rb]).toEqual([0, 0]);
    const c = quiet();
    const long = say({ url: s.wsUrl, text: "z".repeat(60), seat: "A" }, quiet().io);
    await new Promise((r) => setTimeout(r, 200));
    expect(await say({ url: s.wsUrl, text: "again", seat: "A" }, c.io)).toBe(1);
    expect(c.err.join(" ")).toMatch(/seat/);
    expect(await long).toBe(0);
  });
});

describe("the scripted hand", () => {
  it("plays a hand across three seats, one driver each, in order, each heard only by its own seat", { timeout: 60_000 }, async () => {
    const s = await hub();
    const w = watcher(s);
    const { io, out } = quiet();
    expect(await playHand({ url: s.wsUrl, pace: 0 }, io)).toBe(0);
    const lines = w.utterances();
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(new Set(lines.map((m) => m.seat_id))).toEqual(new Set(["seat-1", "seat-2", "seat-3"]));
    expect(new Set(lines.map((m) => m.persona))).toEqual(new Set(["ada", "ben", "cy"]));
    expect(lines.map((m) => m.utterance_id)).toEqual([...new Set(lines.map((m) => m.utterance_id))]); // no id reused
    // every line is spoken in turn: its turn starts before it, and ends before the next seat's turn begins
    const turns = w.seen.filter((m) => m.type === "turn_started" || m.type === "turn_ended" || m.type === "utterance").map((m) => `${m.type}:${m.seat_id}`);
    expect(turns[0]).toBe("turn_started:seat-1");
    expect(turns.slice(0, 3)).toEqual(["turn_started:seat-1", "turn_ended:seat-1", "utterance:seat-1"]);
    expect(w.seen.filter((m) => m.type === "game_over").length).toBeGreaterThanOrEqual(1);
    expect(out.join("\n")).toMatch(/seat-1/);
  });

  it("says how to start a hub with the three personas when it has none of them", async () => {
    const s = await hub({ personas: false });
    // a hub without a personas file takes any persona name; ask for a hub that has a file without ada, ben and cy
    await writeFile(join(dir, "other.yaml"), "personas:\n  zed:\n    avatar: a.vrm\n");
    const other = await startServer({ staticDir: dir, personas: await loadPersonas(join(dir, "other.yaml")), speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: 5, chunkMs: 100 }) } });
    servers.push(other);
    const { io, err } = quiet();
    expect(await playHand({ url: other.wsUrl, pace: 0 }, io)).toBe(1);
    expect(err.join(" ")).toMatch(/personas\.table\.example\.yaml/);
    expect(s.hub.hasDriver).toBe(false);
  });
});

describe("personas.table.example.yaml", () => {
  it("loads, and has a persona for every seat of the demo table", async () => {
    const { TABLE_SEATS } = await import("../src/table-demo.ts");
    const book = await loadPersonas(fileURLToPath(new URL("../../../personas.table.example.yaml", import.meta.url)));
    for (const seat of TABLE_SEATS) expect(book.get(seat.persona), seat.persona).toBeDefined();
  });
});
