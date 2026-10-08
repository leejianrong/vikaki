import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventLog, readEventLog, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { say, type Io } from "../src/commands.ts";
import { DriverSession } from "../src/driver-session.ts";
import { HubClient } from "../src/hub-client.ts";
import { createMcpServer } from "../src/mcp.ts";

const cliEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
let dir: string;
let servers: RunningServer[] = [];
const toClose: (() => Promise<void>)[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-mcp-"));
  await writeFile(join(dir, "index.html"), "hi");
});
afterEach(async () => {
  await Promise.all(toClose.splice(0).map((f) => f()));
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function hub(opts: { msPerChar?: number; log?: EventLog } = {}) {
  const s = await startServer({
    staticDir: dir,
    hub: opts.log ? { onEvent: opts.log.record } : undefined,
    speech: { tts: new FakeTts({ sampleRate: 16000, msPerChar: opts.msPerChar ?? 5, chunkMs: 100 }) },
  });
  servers.push(s);
  return s.wsUrl;
}

/** An MCP client wired to the server in memory, as an LLM client would be over stdio. */
async function connect(url: string) {
  const session = new DriverSession({ url });
  const server = createMcpServer(session);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  toClose.push(async () => {
    await client.close();
    await session.close();
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const body = r.content[0]!.text;
    return { isError: r.isError === true, body, json: () => JSON.parse(body) as Record<string, unknown> };
  };
  return { client, session, call };
}

const quiet = () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) };
  return { io, out, err };
};

describe("vikaki mcp", () => {
  it("offers say, set_emotion, set_persona and cancel", async () => {
    const { client } = await connect(await hub());
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["cancel", "say", "set_emotion", "set_persona"]);
  });

  it("say speaks the line, waits for it, and reports the outcome and time to first audio", async () => {
    const { call } = await connect(await hub());
    const r = await call("say", { text: "Good morning everyone." });
    expect(r.isError).toBe(false);
    expect(r.json()).toMatchObject({ outcome: "completed" });
    expect(typeof r.json().first_audio_ms).toBe("number");
  });

  it("produces the same event sequence as `vikaki say`", async () => {
    const shape = async (file: string) => (await readEventLog(file)).map((e) => `${e.from}>${e.to} ${e.message.type}`);
    const viaCli = join(dir, "cli.jsonl");
    const l1 = new EventLog(viaCli);
    expect(await say({ url: await hub({ log: l1 }), text: "Good morning everyone." }, quiet().io)).toBe(0);
    await l1.close();
    const viaMcp = join(dir, "mcp.jsonl");
    const l2 = new EventLog(viaMcp);
    const { call } = await connect(await hub({ log: l2 }));
    await call("say", { text: "Good morning everyone." });
    await l2.close();
    const expected = await shape(viaCli);
    expect(expected).toContain("hub>driver speech_finished");
    expect(await shape(viaMcp)).toEqual(expected);
  });

  it("cancel interrupts a line that is being said", async () => {
    const { call } = await connect(await hub({ msPerChar: 100 }));
    const speaking = call("say", { text: "x".repeat(200) });
    await new Promise((r) => setTimeout(r, 400));
    expect((await call("cancel")).isError).toBe(false);
    expect((await speaking).json()).toMatchObject({ outcome: "interrupted", reason: "cancelled" });
  });

  it("with wait false, returns the id at once and that id can be cancelled", async () => {
    const { call } = await connect(await hub({ msPerChar: 100 }));
    const queued = (await call("say", { text: "x".repeat(200), wait: false })).json();
    expect(queued).toMatchObject({ outcome: "queued" });
    expect((await call("cancel", { utterance_id: queued.utterance_id })).json()).toEqual({ cancelled: queued.utterance_id });
  });

  it("holds the single driver slot from its first call, so `vikaki say` gets driver_busy; it takes none before", async () => {
    const url = await hub();
    const { call } = await connect(url);
    const before = await HubClient.connect({ url, role: "driver" }); // merely configured: the slot is free
    await before.close();
    await call("set_emotion", { emotion: "happy" }); // a tool that does not touch the hub does not take it either
    const free = await HubClient.connect({ url, role: "driver" });
    await free.close();
    await call("say", { text: "Hi." });
    const { io, err } = quiet();
    expect(await say({ url, text: "Hi." }, io)).toBe(1);
    expect(err.join(" ")).toMatch(/another driver/);
  });

  it("set_emotion and set_persona are session defaults, and a per-line value wins", async () => {
    const file = join(dir, "e.jsonl");
    const log = new EventLog(file);
    const { call } = await connect(await hub({ log }));
    expect((await call("set_emotion", { emotion: "happy" })).json()).toEqual({ emotion: "happy" });
    expect((await call("set_emotion", { emotion: "blorp" })).json()).toEqual({ emotion: "neutral" }); // never an error
    await call("set_emotion", { emotion: "smug" });
    expect((await call("set_persona", { persona: "ada" })).json()).toEqual({ persona: "ada" });
    await call("say", { text: "One." });
    await call("say", { text: "Two.", emotion: "sad", persona: "ben" });
    await log.close();
    const lines = (await readEventLog(file)).filter((e) => e.message.type === "utterance").map((e) => e.message);
    expect(lines[0]).toMatchObject({ text: "One.", emotion: "smug", persona: "ada" });
    expect(lines[1]).toMatchObject({ text: "Two.", emotion: "sad", persona: "ben" });
  });

  it("tells the model plainly when another driver holds the avatar", async () => {
    const url = await hub();
    const other = await HubClient.connect({ url, role: "driver" });
    toClose.push(() => other.close());
    const { call } = await connect(url);
    const r = await call("say", { text: "Hi." });
    expect(r.isError).toBe(true);
    expect(r.body).toMatch(/Another driver/);
  });

  it("tells the model when no hub is running", async () => {
    const { call } = await connect("ws://127.0.0.1:1/ws");
    const r = await call("say", { text: "Hi." });
    expect(r.isError).toBe(true);
    expect(r.body).toMatch(/vikaki serve/);
  });

  it("works as a real stdio subprocess", async () => {
    const port = new URL(await hub()).port;
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", cliEntry, "mcp", "--port", port], stderr: "pipe" });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    const r = (await client.callTool({ name: "say", arguments: { text: "Hi." } })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0]!.text)).toMatchObject({ outcome: "completed" });
    await client.close();
  }, 30_000);

  it("exits by itself, freeing the driver slot, when its client closes stdin", async () => {
    const url = await hub();
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, "mcp", "--port", new URL(url).port], { stdio: ["pipe", "pipe", "ignore"] });
    toClose.push(async () => void child.kill());
    const lines: Record<string, unknown>[] = [];
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
    });
    const rpc = (o: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
    const reply = async (id: number) => {
      const end = Date.now() + 15_000;
      while (!lines.some((l) => l.id === id)) {
        if (Date.now() > end) throw new Error("no reply");
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    await reply(1);
    rpc({ method: "notifications/initialized" });
    rpc({ id: 2, method: "tools/call", params: { name: "say", arguments: { text: "Hi." } } });
    await reply(2); // it now holds the driver slot
    const exited = new Promise<number | null>((ok) => child.once("exit", (code) => ok(code)));
    child.stdin.end();
    expect(await Promise.race([exited, new Promise((ok) => setTimeout(() => ok("still running"), 5000))])).toBe(0);
    const c = await HubClient.connect({ url, role: "driver" });
    await c.close();
  }, 40_000);
});
