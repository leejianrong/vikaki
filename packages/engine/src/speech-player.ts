import { decodePcm16, make, parseMessage, type Message } from "@vikaki/protocol";
import type { AudioSession } from "./audio-session.ts";
import { Playback, type Output, type ScheduledSlice } from "./playback.ts";

export type LiveState = "connecting" | "connected" | "disconnected";

export interface SpeechPlayerOptions {
  /** ws:// or wss:// address of the hub. */
  url: string;
  session: AudioSession;
  sessionId?: string;
  onState?: (state: LiveState, soundBlocked: boolean) => void;
  /** Every event this player reported, for diagnostics and tests: "started:u1", "finished:u1", ... */
  onReport?: (what: string) => void;
  /** Called for every slice of audio as it is handed to the speakers, with when it will be heard. */
  onScheduled?: (slice: ScheduledSlice) => void;
}

/** Counts time without making sound, for when the browser has not allowed audio yet. */
const silent: Output = {
  now: () => performance.now() / 1000,
  play: () => ({ stop() {} }),
  perfMs: (t) => t * 1000,
};

/**
 * The avatar page's end of the conversation with the hub: receive speech, play it through the same
 * lip-sync path as a microphone, and tell the driver when it starts, ends or is interrupted.
 */
export class SpeechPlayer {
  private ws?: WebSocket;
  private stopped = false;
  private retry = 1000;
  private readonly playback: Playback;
  private readonly timer: ReturnType<typeof setInterval>;
  private web?: Output;
  private current: LiveState = "connecting";
  private lastBlocked = true;

  constructor(private readonly o: SpeechPlayerOptions) {
    this.playback = new Playback(
      () => (o.session.running ? (this.web ??= o.session.webOutput()) : silent),
      {
        started: (id, seat) => {
          o.session.lipsync?.unmute();
          this.report(make("speech_started", { utterance_id: id, ...(seat ? { seat_id: seat } : {}) }), `started:${id}`);
        },
        finished: (id) => this.report(make("speech_finished", { utterance_id: id }), `finished:${id}`),
        interrupted: (id, reason) => {
          o.session.lipsync?.mute(); // the node's own smoothing takes ~200 ms to close the mouth; a cut-off should look instant
          this.report(make("speech_interrupted", { utterance_id: id, reason }), `interrupted:${id}`);
        },
      },
      { scheduled: (slice) => o.onScheduled?.(slice) },
    );
    this.timer = setInterval(() => {
      this.playback.tick();
      // The browser can start allowing sound at any moment (a click, or autoplay settings, or the
      // audio setup finishing), with no event. Say so when it changes.
      const blocked = !o.session.running;
      if (blocked !== this.lastBlocked) this.state(this.current);
    }, 30);
  }

  start(): void {
    this.stopped = false;
    void this.o.session.prepare().catch(() => {}); // lip sync is ready before the first word arrives
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.playback.cancelAll("cancelled");
    this.ws?.close();
  }

  /** A human started talking over the avatar. */
  interruptedByHuman(): void {
    this.playback.cancelAll("human_spoke");
  }

  private state(s: LiveState): void {
    this.current = s;
    this.lastBlocked = !this.o.session.running;
    this.o.onState?.(s, this.lastBlocked);
  }

  private connect(): void {
    if (this.stopped) return;
    this.state("connecting");
    const ws = new WebSocket(this.o.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 1000;
      ws.send(JSON.stringify(make("hello", { role: "viewer", client: "vikaki-page", ...(this.o.sessionId ? { session_id: this.o.sessionId } : {}) })));
    };
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onclose = () => {
      this.state("disconnected");
      this.playback.cancelAll("cancelled"); // the driver's side is gone; do not keep talking
      if (!this.stopped) setTimeout(() => this.connect(), (this.retry = Math.min(this.retry * 2, 5000)));
    };
    ws.onerror = () => ws.close();
  }

  private onMessage(raw: string): void {
    const parsed = parseMessage(raw);
    if (!parsed.ok) return;
    const m: Message = parsed.message;
    switch (m.type) {
      case "welcome":
        this.state("connected");
        break;
      case "audio":
        this.playback.push({
          utteranceId: m.utterance_id,
          seatId: m.seat_id,
          samples: decodePcm16(m.pcm),
          sampleRate: m.sample_rate,
          final: m.final,
          sentenceIndex: m.sentence_index,
          sentenceText: m.sentence_text,
        });
        break;
      case "cancel":
        this.playback.cancel(m.utterance_id);
        break;
      default:
        break; // emotions, turns and the like are for later slices
    }
  }

  private report(message: Message, what: string): void {
    this.o.onReport?.(what);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}
