import WebSocket from "ws";
import { make, parseMessage, type ErrorCode, type Message } from "@vikaki/protocol";

export class HubError extends Error {
  constructor(
    readonly code: ErrorCode | "connect_failed" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

export interface ConnectOptions {
  url: string;
  role: "driver" | "controller";
  token?: string;
  /** Shown in the hub's logs. */
  client?: string;
  timeoutMs?: number;
}

/** A small client for the hub: connect, say hello, then read and send messages in order. */
export class HubClient {
  private readonly inbox: Message[] = [];
  private waiter?: () => void;
  private closed = false;
  welcome!: Extract<Message, { type: "welcome" }>;

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const parsed = parseMessage(data.toString());
      if (parsed.ok) this.inbox.push(parsed.message);
      this.waiter?.();
    });
    ws.on("close", () => {
      this.closed = true;
      this.waiter?.();
    });
  }

  static async connect(o: ConnectOptions): Promise<HubClient> {
    const ws = new WebSocket(o.url);
    await new Promise<void>((ok, fail) => {
      ws.once("open", () => ok());
      ws.once("error", (err) => fail(new HubError("connect_failed", `cannot reach ${o.url} (${err.message}). Is \`vikaki serve\` running, and on this port?`)));
    });
    const client = new HubClient(ws);
    client.send(make("hello", { role: o.role, ...(o.token ? { token: o.token } : {}), client: o.client ?? "vikaki-cli" }));
    const first = await client.next(o.timeoutMs ?? 5000);
    if (first?.type === "error") {
      ws.close();
      throw new HubError(first.code, first.message);
    }
    if (first?.type !== "welcome") {
      ws.close();
      throw new HubError("timeout", "the hub did not answer hello");
    }
    client.welcome = first;
    return client;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(message: Message): void {
    this.ws.send(JSON.stringify(message));
  }

  /** The next message, or undefined if the connection closed or `ms` passed first. */
  async next(ms: number): Promise<Message | undefined> {
    const deadline = Date.now() + ms;
    while (this.inbox.length === 0) {
      const left = deadline - Date.now();
      if (this.closed || left <= 0) return undefined;
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, left);
        this.waiter = () => {
          clearTimeout(t);
          ok();
        };
      });
    }
    return this.inbox.shift();
  }

  /** Close after everything sent has gone out. */
  async close(): Promise<void> {
    if (this.closed) return;
    await new Promise<void>((ok) => {
      this.ws.once("close", () => ok());
      this.ws.close();
    });
  }
}

export function hubUrl(opts: { url?: string; port?: string }): string {
  return opts.url ?? `ws://127.0.0.1:${opts.port ?? "8787"}/ws`;
}
