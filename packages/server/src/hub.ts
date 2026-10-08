import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { DRIVER_MAY_SEND, make, parseMessage, VIEWER_MAY_SEND, type ErrorCode, type Message } from "@vikaki/protocol";

export interface HubOptions {
  /** If set, a driver must send this token in `hello`. Viewers never need one. */
  token?: string;
  /** Extra browser origins allowed to connect, besides the hub's own page. */
  allowedOrigins?: string[];
  /** Called for every message the hub accepts or sends, in order. Used for the JSONL log. */
  onEvent?: (event: HubEvent) => void;
  /** Close a connection that has not said hello after this long. */
  helloTimeoutMs?: number;
}

export interface HubEvent {
  at: number;
  from: "driver" | "viewer" | "hub";
  to: "driver" | "viewers";
  message: Message;
}

type Role = "driver" | "viewer";
const MAX_PAYLOAD = 256 * 1024;
const DEDUP_LIMIT = 2000;

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * One driver (a game, an LLM, a script) sends utterances; any number of viewers (avatar pages)
 * play them and report back (ADR-0001). The hub validates, enforces who may send what, and relays.
 */
export class Hub {
  private readonly wss: WebSocketServer;
  private driver?: WebSocket;
  private readonly viewers = new Set<WebSocket>();
  private readonly roles = new WeakMap<WebSocket, Role>();
  private readonly seen = new Set<string>();

  constructor(
    server: Server,
    private readonly opts: HubOptions = {},
  ) {
    this.wss = new WebSocketServer({
      server,
      path: "/ws",
      maxPayload: MAX_PAYLOAD,
      verifyClient: (info, done) => {
        const problem = this.checkRequest(info.req);
        if (problem) done(false, 403, problem);
        else done(true);
      },
    });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  get hasDriver(): boolean {
    return this.driver !== undefined;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** Send a hub-originated message to the driver, such as a TTS failure. */
  toDriver(message: Message): void {
    this.send(this.driver, message);
    this.opts.onEvent?.({ at: Date.now(), from: "hub", to: "driver", message });
  }

  /** Send a hub-originated message to every viewer, such as audio to play. */
  toViewers(message: Message): void {
    for (const v of this.viewers) this.send(v, message);
    this.opts.onEvent?.({ at: Date.now(), from: "hub", to: "viewers", message });
  }

  async close(): Promise<void> {
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((ok) => this.wss.close(() => ok()));
  }

  // ---- connection handling ----

  /**
   * A web page in the user's browser can open a WebSocket to localhost. Refuse other sites, and
   * refuse Host headers that are not local names (DNS rebinding).
   */
  private checkRequest(req: IncomingMessage): string | undefined {
    const host = (req.headers.host ?? "").toLowerCase();
    const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
    if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname ?? "")) return "unexpected Host header";
    const origin = req.headers.origin;
    if (origin === undefined) return undefined; // not a browser: the CLI, a script, a game process
    if (origin === `http://${host}` || this.opts.allowedOrigins?.includes(origin)) return undefined;
    return "origin not allowed";
  }

  private onConnection(ws: WebSocket): void {
    const timer = setTimeout(() => {
      if (!this.roles.has(ws)) {
        this.fail(ws, "bad_message", "send `hello` first");
        ws.close(1008, "no hello");
      }
    }, this.opts.helloTimeoutMs ?? 5000);
    ws.on("close", () => {
      clearTimeout(timer);
      this.viewers.delete(ws);
      if (this.driver === ws) this.driver = undefined;
    });
    ws.on("error", () => ws.terminate());
    ws.on("message", (data) => this.onMessage(ws, data.toString()));
  }

  private onMessage(ws: WebSocket, raw: string): void {
    const parsed = parseMessage(raw);
    const role = this.roles.get(ws);

    if (!parsed.ok) {
      this.fail(ws, parsed.code, parsed.message);
      if (!role) ws.close(1008, parsed.code); // a client that cannot say hello cannot stay
      return;
    }
    const message = parsed.message;

    if (!role) {
      if (message.type !== "hello") {
        this.fail(ws, "bad_message", "send `hello` first");
        ws.close(1008, "no hello");
        return;
      }
      this.admit(ws, message);
      return;
    }

    if (message.type === "hello") return void this.fail(ws, "bad_message", "already said hello");
    const allowed = role === "driver" ? DRIVER_MAY_SEND : VIEWER_MAY_SEND;
    if (!allowed.includes(message.type)) {
      return void this.fail(ws, "not_allowed", `a ${role} may not send ${message.type}`);
    }

    if (role === "driver") {
      for (const v of this.viewers) this.send(v, message);
      this.opts.onEvent?.({ at: Date.now(), from: "driver", to: "viewers", message });
    } else {
      // Several viewers may report the same thing. The driver should hear it once.
      const key = "utterance_id" in message ? `${message.type}:${message.utterance_id}` : undefined;
      if (key) {
        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (this.seen.size > DEDUP_LIMIT) this.seen.delete(this.seen.values().next().value as string);
      }
      this.send(this.driver, message);
      this.opts.onEvent?.({ at: Date.now(), from: "viewer", to: "driver", message });
    }
  }

  private admit(ws: WebSocket, hello: Extract<Message, { type: "hello" }>): void {
    if (hello.role === "driver") {
      if (this.opts.token !== undefined && !this.tokenMatches(hello.token)) {
        this.fail(ws, "unauthorized", "wrong or missing token");
        ws.close(1008, "unauthorized");
        return;
      }
      if (this.driver) {
        this.fail(ws, "driver_busy", "another driver is already connected");
        ws.close(1008, "driver_busy");
        return;
      }
      this.driver = ws;
    } else {
      this.viewers.add(ws);
    }
    this.roles.set(ws, hello.role);
    this.send(ws, make("welcome", { role: hello.role, ...(hello.session_id ? { session_id: hello.session_id } : {}) }));
  }

  private tokenMatches(given: string | undefined): boolean {
    return given !== undefined && timingSafeEqual(sha(given), sha(this.opts.token ?? ""));
  }

  private fail(ws: WebSocket, code: ErrorCode, message: string): void {
    this.send(ws, make("error", { code, message }));
  }

  private send(ws: WebSocket | undefined, message: Message): void {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }
}
