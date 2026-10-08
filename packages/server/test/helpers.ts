import { expect } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "@vikaki/protocol";

/** A small client that queues what it receives so tests can read it in order. */
export class Client {
  readonly inbox: Record<string, unknown>[] = [];
  closeCode?: number;
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      this.inbox.push(JSON.parse(d.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
    ws.on("close", (code) => {
      this.closeCode = code;
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static open(url: string, headers: Record<string, string> = {}): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      ws.once("open", () => resolve(new Client(ws)));
      ws.once("unexpected-response", (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
      ws.once("error", reject);
    });
  }

  static async join(url: string, role: "driver" | "viewer", extra: Record<string, unknown> = {}): Promise<Client> {
    const c = await Client.open(url);
    c.send({ protocol_version: PROTOCOL_VERSION, type: "hello", role, ...extra });
    return c;
  }

  send(obj: unknown): void {
    this.ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
  }

  async next(): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 2000;
    while (this.inbox.length === 0) {
      if (Date.now() > deadline) throw new Error("timed out waiting for a message");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
    return this.inbox.shift()!;
  }

  /** Assert that nothing arrives for a short while. */
  async quiet(ms = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
    expect(this.inbox).toEqual([]);
  }

  async closed(): Promise<number | undefined> {
    const deadline = Date.now() + 2000;
    while (this.closeCode === undefined && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    return this.closeCode;
  }

  close(): void {
    this.ws.close();
  }
}


/** Poll until `check` is true, or fail after `ms`. */
export async function until(check: () => boolean, ms = 3000, what = "condition"): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const utterance = (over: Record<string, unknown> = {}) => ({
  protocol_version: PROTOCOL_VERSION,
  type: "utterance",
  seat_id: "seat-1",
  utterance_id: "u1",
  text: "hello there",
  ...over,
});
