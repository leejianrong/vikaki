import { createWriteStream, type WriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import type { HubEvent } from "./hub.ts";

/** A log line is a hub event; audio is kept as its size only, since the samples would dwarf everything else and can be made again. */
export type LoggedEvent = Omit<HubEvent, "message"> & { message: Record<string, unknown> };

export function toLogLine(event: HubEvent): string {
  const message: Record<string, unknown> = { ...event.message };
  if (event.message.type === "audio") {
    message.pcm_bytes = Buffer.byteLength(event.message.pcm, "base64");
    delete message.pcm;
  }
  return JSON.stringify({ ...event, message });
}

/** One JSON object per line: `{ at, from, to, message }`, in the order the hub saw them. */
export class EventLog {
  private readonly out: WriteStream;

  constructor(path: string) {
    this.out = createWriteStream(path, { flags: "w" });
  }

  /** Pass this to the hub's `onEvent`. */
  record = (event: HubEvent): void => {
    this.out.write(toLogLine(event) + "\n");
  };

  async close(): Promise<void> {
    this.out.end();
    await once(this.out, "close");
  }
}

export async function readEventLog(path: string): Promise<LoggedEvent[]> {
  const lines = (await readFile(path, "utf8")).split("\n");
  const events: LoggedEvent[] = [];
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      const e = JSON.parse(line) as LoggedEvent;
      if (typeof e.at !== "number" || typeof e.from !== "string" || typeof e.message?.type !== "string") throw new Error("not an event");
      events.push(e);
    } catch {
      throw new Error(`${path}:${i + 1}: not a vikaki event line`);
    }
  });
  return events;
}
