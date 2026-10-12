import WebSocket from "ws";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";

export type Msg = Record<string, unknown> & { type: string; utterance_id?: string };
export interface SeatDef {
  seat_id: string;
  persona: string;
}

/** Three seats at a table, each with its own persona. */
export const SEATS: readonly SeatDef[] = [
  { seat_id: "seat-1", persona: "ada" },
  { seat_id: "seat-2", persona: "ben" },
  { seat_id: "seat-3", persona: "cy" },
];

/** A driver for one seat that remembers everything the hub told it (ADR-0017). */
export class SeatDriver {
  readonly events: Msg[] = [];
  private constructor(
    readonly ws: WebSocket,
    readonly seat: SeatDef,
  ) {
    ws.on("message", (d) => this.events.push(JSON.parse(d.toString())));
  }

  static async connect(url: string, seat: SeatDef): Promise<SeatDriver> {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
    ws.send(JSON.stringify(make("hello", { role: "driver", seats: [seat] })));
    const d = new SeatDriver(ws, seat);
    await d.waitFor((m) => m.type === "welcome");
    return d;
  }

  /** The line names no persona: the hub knows the seat's. */
  say(text: string, id: string, extra: Record<string, unknown> = {}) {
    this.ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: this.seat.seat_id, utterance_id: id, text, ...extra }));
  }

  send(type: "turn_started" | "turn_ended") {
    this.ws.send(JSON.stringify(make(type, { seat_id: this.seat.seat_id }))); // no persona named: the seat's is used
  }

  async waitFor(pred: (m: Msg) => boolean, ms = 40_000): Promise<void> {
    const end = Date.now() + ms;
    while (!this.events.some(pred)) {
      if (Date.now() > end) throw new Error(`timed out; saw ${this.events.map((e) => e.type).join(",")}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  heard(type: string) {
    return this.events.filter((m) => m.type === type).map((m) => m.utterance_id);
  }
}
