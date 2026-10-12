import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { PersonaBook } from "./personas.ts";
import { CONTROLLER_MAY_SEND, DRIVER_MAY_SEND, EMOTIONS, make, parseMessage, VIEWER_MAY_SEND, type ErrorCode, type Message } from "@vikaki/protocol";

export interface HubOptions {
  /** If set, a driver must send this token in `hello`. Viewers never need one. */
  token?: string;
  /** Extra browser origins allowed to connect, besides the hub's own page. */
  allowedOrigins?: string[];
  /** Called for every message the hub accepts or sends, in order. Used for the JSONL log. */
  onEvent?: (event: HubEvent) => void;
  /** Close a connection that has not said hello after this long. */
  helloTimeoutMs?: number;
  /** Shown to clients in `welcome`. */
  speechName?: string;
  /** Shown to clients in `welcome`. */
  speechVoice?: string;
  /** Called with each valid message the driver sends, after it has been relayed. */
  onDriverMessage?: (message: Message) => void;
  /** The named characters, from a personas file. When set, a line naming a persona that is not in it is refused. */
  personas?: PersonaBook;
  /** Where warnings go, such as an emotion the avatar does not know. Defaults to the console. */
  warn?: (message: string) => void;
  /** Called when a driver disconnects, with the ids of its lines that had not finished: those are the ones to stop. */
  onDriverGone?: (utteranceIds: string[]) => void;
}

export interface HubEvent {
  at: number;
  from: "driver" | "controller" | "viewer" | "hub";
  to: "driver" | "viewers";
  message: Message;
}

type Role = "driver" | "viewer" | "controller";
/** A connected driver. `seats` is absent for the driver of the whole table; otherwise seat id to the persona it uses (or undefined). */
interface DriverInfo {
  seats?: Map<string, string | undefined>;
}
const MAX_PAYLOAD = 256 * 1024;
const DEDUP_LIMIT = 2000;

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * One driver (a game, an LLM, a script) sends utterances; any number of viewers (avatar pages)
 * play them and report back (ADR-0001). The hub validates, enforces who may send what, and relays.
 * At a table with several LLM seats, each can be its own driver, declaring its seats in `hello` (ADR-0017): a seat has one driver,
 * a driver may speak only for its seats, and hears back only about its own lines.
 */
export class Hub {
  private readonly wss: WebSocketServer;
  private readonly drivers = new Map<WebSocket, DriverInfo>();
  private readonly viewers = new Set<WebSocket>();
  private readonly roles = new WeakMap<WebSocket, Role>();
  /** The persona a viewer said it shows (absent: it shows every line). */
  private readonly viewerPersona = new WeakMap<WebSocket, string>();
  private readonly seen = new Set<string>();
  /** Utterances a driver has sent that no one has reported finished or interrupted yet, and whose they are: what "cancel everything" stops. */
  private readonly inFlight = new Map<string, WebSocket>();
  /** Lines refused for an unknown persona, so the rest of a streamed one is ignored rather than scolded again. */
  private readonly refused = new Set<string>();

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
    return this.drivers.size > 0;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** How many viewers will play a line of this persona: those showing it, and those showing everyone. */
  viewerCountFor(persona: string | undefined): number {
    let n = 0;
    for (const v of this.viewers) {
      const shows = this.viewerPersona.get(v);
      if (shows === undefined || shows === persona) n++;
    }
    return n;
  }

  /** Send a hub-originated message to the driver it is about, such as a TTS failure. */
  toDriver(message: Message): void {
    const target = this.driverFor(message);
    this.noteReport(message);
    this.send(target, message);
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
      if (this.drivers.delete(ws)) {
        const lines = [...this.inFlight].filter(([, owner]) => owner === ws).map(([id]) => id);
        for (const id of lines) this.inFlight.delete(id);
        // The next driver starts afresh and may reuse ids (a reloaded page counts from demo-1 again).
        if (this.drivers.size === 0) this.seen.clear();
        else for (const id of lines) for (const t of ["speech_started", "speech_finished", "speech_interrupted", "error"]) this.seen.delete(`${t}:${id}`);
        this.opts.onDriverGone?.(lines);
      }
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
    const allowed = role === "driver" ? DRIVER_MAY_SEND : role === "controller" ? CONTROLLER_MAY_SEND : VIEWER_MAY_SEND;
    if (!allowed.includes(message.type)) {
      return void this.fail(ws, "not_allowed", `a ${role} may not send ${message.type}`);
    }

    if (role === "driver" || role === "controller") {
      const info = this.drivers.get(ws);
      if (message.type === "cancel" && message.utterance_id === undefined) {
        // "Cancel everything" becomes one ordinary cancel per utterance still in flight, so viewers and the engine need no new case.
        // A seat driver stops only its own lines; the driver of the whole table and a controller stop all of them.
        for (const [id, owner] of [...this.inFlight]) if (!info?.seats || owner === ws) this.relayFromDriver(role, ws, make("cancel", { utterance_id: id }));
      } else {
        this.relayFromDriver(role, ws, message);
      }
    } else {
      // Several viewers may report the same thing. The driver should hear it once.
      const key = "utterance_id" in message ? `${message.type}:${message.utterance_id}` : undefined;
      if (key) {
        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (this.seen.size > DEDUP_LIMIT) this.seen.delete(this.seen.values().next().value as string);
      }
      const target = this.driverFor(message);
      this.noteReport(message);
      this.send(target, message);
      this.opts.onEvent?.({ at: Date.now(), from: "viewer", to: "driver", message });
    }
  }

  private relayFromDriver(from: "driver" | "controller", ws: WebSocket, message: Message): void {
    const seats = this.drivers.get(ws)?.seats;
    if (seats && !this.mayAct(ws, seats, message)) return;
    if (message.type === "utterance") {
      const owner = this.inFlight.get(message.utterance_id);
      if (owner !== undefined && owner !== ws) {
        return void this.send(ws, make("error", { code: "bad_message", message: `utterance ${message.utterance_id} is in use by another driver`, utterance_id: message.utterance_id }));
      }
    }
    // A seat has a persona: a line or turn that does not name one gets its seat's.
    if (seats && (message.type === "utterance" || message.type === "turn_started" || message.type === "turn_ended") && message.persona === undefined) {
      const bound = seats.get(message.seat_id);
      if (bound !== undefined) message = { ...message, persona: bound };
    }
    if (message.type === "utterance" && this.opts.personas) {
      if (this.refused.has(message.utterance_id)) return;
      if (message.persona !== undefined) {
        const persona = this.opts.personas.get(message.persona);
        if (!persona) {
          this.refused.add(message.utterance_id);
          if (this.refused.size > DEDUP_LIMIT) this.refused.delete(this.refused.values().next().value as string);
          this.send(ws, make("error", { code: "unknown_persona", message: `no persona "${message.persona}" (known: ${this.opts.personas.names.join(", ")})`, utterance_id: message.utterance_id }));
          return;
        }
        if (message.emotion === undefined && persona.emotion) message = { ...message, emotion: persona.emotion };
      }
    }
    if (message.type === "utterance") {
      if (message.emotion !== undefined && !(EMOTIONS as readonly string[]).includes(message.emotion)) {
        (this.opts.warn ?? console.warn)(`utterance ${message.utterance_id}: unknown emotion "${message.emotion}", showing neutral`);
      }
      this.inFlight.set(message.utterance_id, ws);
      if (this.inFlight.size > DEDUP_LIMIT) this.inFlight.delete(this.inFlight.keys().next().value as string);
    } else if (message.type === "cancel" && message.utterance_id !== undefined) {
      this.inFlight.delete(message.utterance_id);
    }
    for (const v of this.viewers) this.send(v, message);
    this.opts.onEvent?.({ at: Date.now(), from, to: "viewers", message });
    this.opts.onDriverMessage?.(message);
  }

  /** Whether a seat driver may send this: only for its own seats, and only cancel its own lines. Tells the driver if not. */
  private mayAct(ws: WebSocket, seats: Map<string, string | undefined>, message: Message): boolean {
    let ok = true;
    let what = "";
    if (message.type === "utterance" || message.type === "turn_started" || message.type === "turn_ended") {
      ok = seats.has(message.seat_id);
      what = `seat ${message.seat_id} is not one of this driver's seats`;
    } else if (message.type === "game_over") {
      ok = message.seat_id !== undefined && seats.has(message.seat_id);
      what = "a seat driver may send game_over only for its own seat";
    } else if (message.type === "cancel" && message.utterance_id !== undefined) {
      const owner = this.inFlight.get(message.utterance_id);
      ok = owner === undefined || owner === ws;
      what = `utterance ${message.utterance_id} belongs to another driver`;
    }
    if (!ok) this.send(ws, make("error", { code: "not_allowed", message: what, ...("utterance_id" in message && message.utterance_id ? { utterance_id: message.utterance_id } : {}) }));
    return ok;
  }

  /** The driver a report is for: the one that sent the line, else the driver of the whole table, else the one that has the seat. */
  private driverFor(message: Message): WebSocket | undefined {
    const uid = "utterance_id" in message ? message.utterance_id : undefined;
    const owner = uid !== undefined ? this.inFlight.get(uid) : undefined;
    if (owner) return owner;
    for (const [ws, info] of this.drivers) if (!info.seats) return ws;
    const seat = "seat_id" in message ? message.seat_id : undefined;
    if (seat !== undefined) for (const [ws, info] of this.drivers) if (info.seats?.has(seat)) return ws;
    return undefined;
  }

  private noteReport(message: Message): void {
    if (message.type === "speech_finished" || message.type === "speech_interrupted") this.inFlight.delete(message.utterance_id);
  }

  private admit(ws: WebSocket, hello: Extract<Message, { type: "hello" }>): void {
    if (hello.seats !== undefined && hello.role !== "driver") {
      this.fail(ws, "bad_message", "only a driver lists seats");
      ws.close(1008, "bad_message");
      return;
    }
    if (hello.role === "driver" || hello.role === "controller") {
      if (this.opts.token !== undefined && !this.tokenMatches(hello.token)) {
        this.fail(ws, "unauthorized", "wrong or missing token");
        ws.close(1008, "unauthorized");
        return;
      }
      if (hello.role === "driver") {
        const seats = this.seatsOf(ws, hello);
        if (seats === null) return;
        const busy = this.busyWith(seats);
        if (busy) {
          this.fail(ws, "driver_busy", busy);
          ws.close(1008, "driver_busy");
          return;
        }
        this.drivers.set(ws, { seats });
      }
    } else {
      this.viewers.add(ws);
      if (hello.persona) this.viewerPersona.set(ws, hello.persona);
    }
    this.roles.set(ws, hello.role);
    this.send(
      ws,
      make("welcome", {
        role: hello.role,
        ...(hello.session_id ? { session_id: hello.session_id } : {}),
        ...(this.opts.speechName ? { speech: this.opts.speechName } : {}),
        ...(this.opts.speechVoice ? { voice: this.opts.speechVoice } : {}),
        ...(this.opts.personas ? { personas: this.opts.personas.names } : {}),
      }),
    );
  }

  /** The seats a driver asked for, `undefined` for the whole table, or `null` after refusing it (a seat twice, or a persona the hub lacks). */
  private seatsOf(ws: WebSocket, hello: Extract<Message, { type: "hello" }>): Map<string, string | undefined> | undefined | null {
    if (!hello.seats) return undefined;
    const seats = new Map<string, string | undefined>();
    for (const s of hello.seats) {
      if (seats.has(s.seat_id)) {
        this.fail(ws, "bad_message", `seat ${s.seat_id} is listed twice`);
        ws.close(1008, "bad_message");
        return null;
      }
      if (s.persona !== undefined && this.opts.personas && !this.opts.personas.get(s.persona)) {
        this.fail(ws, "unknown_persona", `seat ${s.seat_id} uses persona "${s.persona}", which is not one of: ${this.opts.personas.names.join(", ")}`);
        ws.close(1008, "unknown_persona");
        return null;
      }
      seats.set(s.seat_id, s.persona);
    }
    return seats;
  }

  /** Why a driver for these seats (`undefined`: the whole table) cannot join now, if it cannot. */
  private busyWith(seats: Map<string, string | undefined> | undefined): string | undefined {
    for (const info of this.drivers.values()) {
      if (!seats || !info.seats) return "another driver is already connected";
      for (const seat of seats.keys()) if (info.seats.has(seat)) return `seat ${seat} already has a driver`;
    }
    return undefined;
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
