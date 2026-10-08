import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePcm16, make } from "@vikaki/protocol";
import { EventLog, readEventLog } from "../src/event-log.ts";

describe("the JSONL event log", () => {
  it("writes one event per line, in order, and reads them back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-log-"));
    const path = join(dir, "events.jsonl");
    const log = new EventLog(path);
    log.record({ at: 1, from: "driver", to: "viewers", message: make("utterance", { seat_id: "s", utterance_id: "u1", text: "Hi." }) });
    log.record({ at: 2, from: "viewer", to: "driver", message: make("speech_finished", { utterance_id: "u1" }) });
    await log.close();
    const events = await readEventLog(path);
    expect(events.map((e) => [e.at, e.from, e.message.type])).toEqual([[1, "driver", "utterance"], [2, "viewer", "speech_finished"]]);
  });

  it("keeps the size of audio, not the samples", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-log-"));
    const path = join(dir, "events.jsonl");
    const log = new EventLog(path);
    const pcm = encodePcm16(new Float32Array(480));
    log.record({ at: 1, from: "hub", to: "viewers", message: make("audio", { utterance_id: "u1", seat_id: "s", seq: 0, sample_rate: 24000, pcm, final: false }) });
    await log.close();
    const [e] = await readEventLog(path);
    expect(e!.message).toMatchObject({ type: "audio", pcm_bytes: 960 });
    expect(e!.message).not.toHaveProperty("pcm");
  });

  it("names the line of one that is not an event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-log-"));
    const path = join(dir, "bad.jsonl");
    await writeFile(path, '{"at":1,"from":"driver","to":"viewers","message":{"type":"cancel"}}\nnot json\n');
    await expect(readEventLog(path)).rejects.toThrow(/bad\.jsonl:2/);
  });
});
