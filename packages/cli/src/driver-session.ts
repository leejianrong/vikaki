import { make, normaliseEmotion, type Message } from "@vikaki/protocol";
import type { Target } from "./commands.ts";
import { HubClient, HubError } from "./hub-client.ts";

export interface SayResult {
  utterance_id: string;
  /** `queued` only when the caller did not wait. */
  outcome: "completed" | "interrupted" | "failed" | "queued";
  reason?: string;
  error?: { code: string; message: string };
  /** Sent to first sound heard, measured here. */
  first_audio_ms?: number;
  /** Sent to the first video frame with the mouth open, when a page reported it. */
  first_frame_ms?: number;
}

interface Pending {
  sentAt: number;
  heardAfter?: number;
  done: (r: SayResult) => void;
}

/**
 * One long-lived driver connection that several tool calls share: the MCP server's view of the hub.
 * It connects on first use (so merely configuring `vikaki mcp` does not take the driver slot) and keeps the
 * slot until closed. Emotion and persona are session defaults stamped onto each line.
 */
export class DriverSession {
  emotion?: string;
  persona?: string;
  private client?: HubClient;
  private connecting?: Promise<HubClient>;
  private readonly pending = new Map<string, Pending>();
  private count = 0;

  constructor(private readonly target: Target) {}

  get connected(): boolean {
    return this.client !== undefined && !this.client.isClosed;
  }

  private async hub(): Promise<HubClient> {
    if (this.client && !this.client.isClosed) return this.client;
    this.connecting ??= HubClient.connect({ url: this.target.url, token: this.target.token, role: "driver", client: "vikaki-mcp" }).then((c) => {
      this.client = c;
      void this.pump(c);
      return c;
    });
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async pump(c: HubClient): Promise<void> {
    while (!c.isClosed) {
      const m = await c.next(30_000);
      if (m) this.onMessage(m);
    }
    // The hub went away: nobody will report on what was in flight.
    for (const [id, p] of this.pending) p.done({ utterance_id: id, outcome: "failed", error: { code: "hub_disconnected", message: "the connection to the hub closed" } });
    this.pending.clear();
  }

  private onMessage(m: Message): void {
    if (!("utterance_id" in m) || m.utterance_id === undefined) return;
    const p = this.pending.get(m.utterance_id);
    if (!p) return;
    const base = { utterance_id: m.utterance_id, ...(p.heardAfter !== undefined ? { first_audio_ms: p.heardAfter } : {}) };
    if (m.type === "speech_started") p.heardAfter = Date.now() - p.sentAt;
    else if (m.type === "speech_finished") {
      const t = m.timing;
      this.finish(m.utterance_id, p, {
        ...base,
        outcome: "completed",
        ...(t?.frame_ms !== undefined && p.heardAfter !== undefined ? { first_frame_ms: p.heardAfter + t.frame_ms - t.audio_ms } : {}),
      });
    } else if (m.type === "speech_interrupted") this.finish(m.utterance_id, p, { ...base, outcome: "interrupted", reason: m.reason });
    else if (m.type === "error") this.finish(m.utterance_id, p, { ...base, outcome: "failed", error: { code: m.code, message: m.message } });
  }

  private finish(id: string, p: Pending, r: SayResult): void {
    this.pending.delete(id);
    p.done(r);
  }

  /** Speak a line. Resolves when it is over, or at once with `wait: false`. Throws HubError if the hub cannot be used. */
  async say(o: { text: string; persona?: string; emotion?: string; intensity?: number; wait?: boolean }): Promise<SayResult> {
    const c = await this.hub();
    if (c.welcome.speech === "off") throw new HubError("internal", "this hub has speech turned off (started with --tts none), so there is nothing to say it with");
    const id = `mcp-${Date.now().toString(36)}-${++this.count}`;
    const emotion = o.emotion ?? this.emotion;
    const persona = o.persona ?? this.persona;
    const result = new Promise<SayResult>((done) => this.pending.set(id, { sentAt: Date.now(), done }));
    c.send(
      make("utterance", {
        seat_id: "mcp",
        utterance_id: id,
        text: o.text,
        ...(emotion ? { emotion } : {}),
        ...(o.intensity !== undefined ? { intensity: o.intensity } : {}),
        ...(persona ? { persona } : {}),
      }),
    );
    if (o.wait === false) return { utterance_id: id, outcome: "queued" };
    return result;
  }

  /** Stop one line, or everything speaking or queued. */
  async cancel(utteranceId?: string): Promise<void> {
    const c = await this.hub();
    c.send(make("cancel", utteranceId ? { utterance_id: utteranceId } : {}));
  }

  /** Unknown names become `neutral`, as the protocol says; the name actually used is returned. */
  setEmotion(name: string): string {
    return (this.emotion = normaliseEmotion(name));
  }

  /**
   * Set the default persona, after checking the name against the hub's personas file (over HTTP, so it does not take the
   * driver slot). A name the hub does not know is refused and the previous persona is kept. If the hub cannot be asked, or has
   * no personas file, the name is accepted and the hub has the last word on each line.
   */
  async setPersona(name: string): Promise<{ persona: string; style?: string; emotion?: string }> {
    const known = await this.personas();
    if (known && known.length > 0) {
      const found = known.find((p) => p.name === name);
      if (!found) {
        throw new Error(`no persona "${name}" on this hub (known: ${known.map((p) => p.name).join(", ")}). ${this.persona ? `The persona is still "${this.persona}".` : "No persona is set."}`);
      }
      this.persona = name;
      return { persona: name, ...(found.style ? { style: found.style } : {}), ...(found.emotion ? { emotion: found.emotion } : {}) };
    }
    return { persona: (this.persona = name) };
  }

  /** The hub's personas, or undefined if it cannot be asked. */
  private async personas(): Promise<{ name: string; style?: string; emotion?: string }[] | undefined> {
    try {
      const http = new URL(this.target.url);
      http.protocol = http.protocol === "wss:" ? "https:" : "http:";
      http.pathname = "/avatar/personas.json";
      const res = await fetch(http, { signal: AbortSignal.timeout(2000) });
      return res.ok ? ((await res.json()) as { name: string; style?: string; emotion?: string }[]) : undefined;
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}
