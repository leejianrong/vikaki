import { make, parseMessage, PROTOCOL_VERSION, type Message } from "@vikaki/protocol";

export type DriverState = "connecting" | "ready" | "busy" | "disconnected";

export interface DriverHandlers {
  state(state: DriverState, info: { speech?: string; voice?: string }): void;
  message(message: Message): void;
}

/** Split text into the pieces a streaming LLM might send: a word and the space after it. */
export function wordPieces(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/** "412 ms" below a second, "2.3 s" above. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The page acting as a driver: it connects to the hub, sends text, and hears what comes back.
 * Used by the speech demo. Real drivers (a game, an LLM) speak the same protocol from their own process.
 */
export class DriverConsole {
  private ws?: WebSocket;
  private n = 0;
  private closed = false;
  private busyTries = 0;
  private expectClose = false;
  private info: { speech?: string; voice?: string } = {};
  private readonly streams = new Map<string, ReturnType<typeof setTimeout>[]>();

  constructor(
    private readonly url: string,
    private readonly handlers: DriverHandlers,
  ) {}

  connect(): void {
    if (this.closed) return;
    this.handlers.state("connecting", this.info);
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(make("hello", { role: "driver", client: "vikaki-speech-demo" })));
    ws.onmessage = (e) => {
      const parsed = parseMessage(String(e.data));
      if (!parsed.ok) return;
      const m = parsed.message;
      if (m.type === "welcome") {
        this.busyTries = 0;
        this.info = { speech: m.speech, voice: m.voice };
        this.handlers.state("ready", this.info);
      } else if (m.type === "error" && m.code === "driver_busy") {
        // After a quick reload the hub may not have noticed the old connection close yet, so try a few
        // times before deciding that another program really is driving.
        if (++this.busyTries <= 5) {
          this.expectClose = true;
          setTimeout(() => this.connect(), 700);
        } else {
          this.closed = true;
          this.handlers.state("busy", this.info);
        }
      }
      this.handlers.message(m);
    };
    ws.onclose = () => {
      if (this.closed) return;
      if (this.expectClose) {
        this.expectClose = false; // a retry is already scheduled
        return;
      }
      this.handlers.state("disconnected", this.info);
      setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
  }

  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  nextId(): string {
    return `demo-${++this.n}`;
  }

  /** Send a whole line. */
  say(text: string, id: string, emotion?: string): void {
    this.send({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "demo", utterance_id: id, text, ...(emotion ? { emotion } : {}) });
  }

  /** Send a line a word at a time, as a streaming LLM would. */
  stream(text: string, id: string, wordsPerSecond: number, emotion?: string): void {
    const pieces = wordPieces(text);
    const timers: ReturnType<typeof setTimeout>[] = [];
    pieces.forEach((delta, i) => {
      const last = i === pieces.length - 1;
      timers.push(
        setTimeout(() => {
          this.send({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "demo", utterance_id: id, delta, ...(last ? { final: true } : {}), ...(i === 0 && emotion ? { emotion } : {}) });
          if (last) this.streams.delete(id);
        }, (i * 1000) / wordsPerSecond),
      );
    });
    this.streams.set(id, timers);
  }

  cancel(id: string): void {
    for (const t of this.streams.get(id) ?? []) clearTimeout(t); // stop sending the rest of a stream
    this.streams.delete(id);
    this.send(make("cancel", { utterance_id: id }));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private send(m: unknown): void {
    if (this.ready) this.ws!.send(JSON.stringify(m));
  }
}
