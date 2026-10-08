import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventLog, readEventLog, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";
import { cancel, replay, say, type Io } from "../src/commands.ts";
import { HubClient } from "../src/hub-client.ts";

let dir: string;
let servers: RunningServer[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-cli-"));
  await writeFile(join(dir, "index.html"), "hi");
});
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

const quiet = () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) };
  return { io, out, err };
};

async function hub(opts: { speech?: boolean; msPerChar?: number; log?: EventLog } = {}) {
  const s = await startServer({
    staticDir: dir,
    hub: opts.log ? { onEvent: opts.log.record } : undefined,
    speech: opts.speech === false ? undefined : { tts: new FakeTts({ sampleRate: 16000, msPerChar: opts.msPerChar ?? 5, chunkMs: 100 }) },
  });
  servers.push(s);
  return { url: s.wsUrl, server: s };
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("vikaki say", () => {
  it("speaks a line and exits 0 once it is over", async () => {
    const { url } = await hub();
    const { io, out } = quiet();
    expect(await say({ url, text: "Good morning." }, io)).toBe(0);
    expect(out[0]).toBe("speaking...");
    expect(out.at(-1)).toBe("done");
    expect(out.filter((l) => /time to first audio: \d+ ms/.test(l))).toHaveLength(1); // measured by the CLI itself, so it works with no page
    expect(out.join(" ")).not.toMatch(/video frame/); // only a page can see a frame
  });

  it("prints time to first video frame when the page reports it", async () => {
    const { url } = await hub();
    const viewer = new WebSocket(url);
    await new Promise((ok) => viewer.once("open", ok));
    viewer.send(JSON.stringify({ protocol_version: 1, type: "hello", role: "viewer" }));
    viewer.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.type !== "utterance") return;
      const send = (o: object) => viewer.send(JSON.stringify({ protocol_version: 1, utterance_id: m.utterance_id, ...o }));
      send({ type: "speech_started" });
      setTimeout(() => send({ type: "speech_finished", timing: { audio_ms: 100, frame_ms: 140 } }), 50);
    });
    const { io, out } = quiet();
    expect(await say({ url, text: "Hi." }, io)).toBe(0);
    viewer.close();
    const first = Number(/time to first audio: (\d+) ms/.exec(out.join("\n"))![1]);
    // the frame comes 40 ms after the sound, as the page measured it
    expect(out.join("\n")).toContain(`time to first video frame: ${first + 40} ms`);
  });

  it("with --think shows a thinking turn first: turn_started, a pause, turn_ended, then the line", async () => {
    const { url } = await hub();
    const viewer = new WebSocket(url);
    await new Promise((ok) => viewer.once("open", ok));
    viewer.send(JSON.stringify({ protocol_version: 1, type: "hello", role: "viewer" }));
    const seen: { type: string; at: number; persona?: string }[] = [];
    viewer.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (["turn_started", "turn_ended", "utterance"].includes(m.type)) seen.push({ type: m.type, at: Date.now(), persona: m.persona });
      if (m.type === "utterance") {
        const send = (o: object) => viewer.send(JSON.stringify({ protocol_version: 1, utterance_id: m.utterance_id, ...o }));
        send({ type: "speech_started" });
        setTimeout(() => send({ type: "speech_finished" }), 30);
      }
    });
    const { io } = quiet();
    expect(await say({ url, text: "Hi.", thinkSeconds: 0.4, persona: "ada" }, io)).toBe(0);
    viewer.close();
    expect(seen.map((s) => s.type)).toEqual(["turn_started", "turn_ended", "utterance"]);
    expect(seen.map((s) => s.persona)).toEqual(["ada", "ada", "ada"]); // whose turn it is, so a page showing one persona can tell
    expect(seen[1]!.at - seen[0]!.at).toBeGreaterThanOrEqual(350); // it really waited
  });

  it("says plainly that another driver holds the slot", async () => {
    const { url } = await hub();
    const other = await HubClient.connect({ url, role: "driver" });
    const { io, err } = quiet();
    expect(await say({ url, text: "Hi." }, io)).toBe(1);
    expect(err.join(" ")).toMatch(/another driver/);
    await other.close();
  });

  it("explains when no hub is running", async () => {
    const { io, err } = quiet();
    expect(await say({ url: "ws://127.0.0.1:1/ws", text: "Hi." }, io)).toBe(1);
    expect(err.join(" ")).toMatch(/vikaki serve/);
  });

  it("refuses when the hub has speech off", async () => {
    const { url } = await hub({ speech: false });
    const { io, err } = quiet();
    expect(await say({ url, text: "Hi." }, io)).toBe(1);
    expect(err.join(" ")).toMatch(/speech turned off/);
  });
});

describe("vikaki cancel", () => {
  it("stops a line that another process is saying", async () => {
    const { url } = await hub({ msPerChar: 100 });
    const a = quiet();
    const speaking = say({ url, text: "x".repeat(200) }, a.io);
    await waitFor(() => a.out.includes("speaking..."));
    const b = quiet();
    expect(await cancel({ url }, b.io)).toBe(0);
    expect(await speaking).toBe(1);
    expect(a.out).toContain("interrupted (cancelled)");
  });

  it("is a no-op, not an error, when nothing is speaking", async () => {
    const { url } = await hub();
    expect(await cancel({ url }, quiet().io)).toBe(0);
  });

  it("the caller's abort cancels its own line and exits 130", async () => {
    const { url } = await hub({ msPerChar: 100 });
    const a = quiet();
    const ac = new AbortController();
    const speaking = say({ url, text: "x".repeat(200), signal: ac.signal }, a.io);
    await waitFor(() => a.out.includes("speaking..."));
    ac.abort();
    expect(await speaking).toBe(130);
  });
});

describe("vikaki replay", () => {
  const shape = (events: Awaited<ReturnType<typeof readEventLog>>) =>
    events.map((e) => `${e.from}>${e.to} ${e.message.type} ${String(e.message.utterance_id ?? "")} ${e.message.type === "audio" ? `seq${e.message.seq}` : ""}`.trim());

  it("reproduces the same event sequence through a fresh hub", async () => {
    const first = join(dir, "first.jsonl");
    const log1 = new EventLog(first);
    const a = await hub({ log: log1 });
    expect(await say({ url: a.url, text: "Good morning everyone. Shall we begin?" }, quiet().io)).toBe(0);
    await log1.close();

    const second = join(dir, "second.jsonl");
    const log2 = new EventLog(second);
    const b = await hub({ log: log2 });
    const result = await replay({ url: b.url, file: first, speed: 20 }, quiet().io);
    expect(result.code).toBe(0);
    await log2.close();

    const original = shape(await readEventLog(first));
    expect(original.map((l) => l.split(" ")[1])).toEqual(["utterance", "speech_started", "speech_finished"]); // no page connected: the hub keeps time itself
    expect(shape(await readEventLog(second))).toEqual(original);
  });

  it("says so when the log holds nothing to send", async () => {
    const file = join(dir, "empty.jsonl");
    await writeFile(file, "");
    const { url } = await hub();
    const { io, err } = quiet();
    expect((await replay({ url, file }, io)).code).toBe(1);
    expect(err.join(" ")).toMatch(/no driver messages/);
  });
});
