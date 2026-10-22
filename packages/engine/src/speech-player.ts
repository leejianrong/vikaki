import { LineOwners } from "./line-owners.ts";
import type { FirstFrameTimer } from "./first-frame.ts";
import { decodePcm16, make, parseMessage, type Gesture, type Message, type MessageOf } from "@vikaki/protocol";
import type { AudioSession } from "./audio-session.ts";
import { Playback, type Output, type ScheduledSlice } from "./playback.ts";
import { SentenceAssembler, type CompleteSentence } from "./sentences.ts";
import type { SpeechEvent } from "./embed-bridge.ts";

/** How long a reaction's feeling is held when the driver does not say. */
export const DEFAULT_REACT_SECONDS = 1.5;

export type LiveState = "connecting" | "connected" | "disconnected";

/** Whose a line is, as its first message said: the seat and persona a table page needs to pick the avatar that speaks it. */
export interface LineInfo {
  id: string;
  seat?: string;
  persona?: string;
  /** The line is a private thought spoken aloud (VIK-98): the page keeps the mouth still. */
  thought?: boolean;
}

export interface SpeechPlayerOptions {
  /** ws:// or wss:// address of the hub. */
  url: string;
  session: AudioSession;
  sessionId?: string;
  /** Show one persona: play only the lines and turns that name it, and tell the hub so. Without it, this page plays every line. */
  persona?: string;
  onState?: (state: LiveState, soundBlocked: boolean) => void;
  /** Every event this player reported, for diagnostics and tests: "started:u1", "finished:u1", ... */
  onReport?: (what: string) => void;
  /** A line began, ended or was cut off as this page played it, with the seat that spoke it: for the page that frames this one (embed mode). */
  onLifecycle?: (event: SpeechEvent) => void;
  /** Called for every slice of audio as it is handed to the speakers, with when it will be heard. */
  onScheduled?: (slice: ScheduledSlice) => void;
  /** A line with this emotion has begun to be heard (`phase: "start"`), or has ended or been cut off (`"end"`). */
  onEmotion?: (emotion: string | undefined, intensity: number | undefined, phase: "start" | "end", line?: LineInfo) => void;
  /** The driver says a turn began (`true`) or ended (`false`): time for the avatar to look thoughtful. `seatId` is empty when the connection was lost. */
  onTurn?: (thinking: boolean, seatId: string, persona?: string) => void;
  /** A seat reacts without speaking (`react`): a feeling held for a moment, and perhaps a nod, shake or tilt. `persona` is the seat's, when the hub knows it. */
  onReact?: (reaction: { seat: string; persona?: string; emotion?: string; intensity?: number; gesture?: Gesture; seconds: number }) => void;
  /** A seat has a private thought (`thought`): text for the audience, never spoken. `persona` is the seat's, when the hub knows it. */
  onThought?: (thought: { seat: string; persona?: string; text: string }) => void;
  /** The game says it can be paused, and whether it is now (`transport_state`, VIK-135). */
  onTransportState?: (paused: boolean) => void;
  /** Whose thoughts the table voices (`listen_state`, VIK-98). */
  onListenState?: (mode: "seat" | "all" | "off", seat: string | undefined) => void;
  /** The game sent the state of the table (pot, stacks, cards, whose turn): draw it. */
  onTableState?: (state: MessageOf<"table_state">) => void;
  /** A piece of a line's text arrived: the whole `text`, or one `delta` of a line still being written. For a transcript. `thought` marks an inner monologue spoken aloud (VIK-121): not table talk. */
  onText?: (line: { id: string; seat: string; text?: string; delta?: string; to?: string; thought?: boolean }) => void;
  /** Times lines for the `timing` of `speech_finished`. The page's render loop feeds it frames. */
  timer?: FirstFrameTimer;
  /** Called when all the audio of a spoken sentence has arrived, which is before it is heard. */
  onSentence?: (sentence: CompleteSentence) => void;
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
  private readonly sentences = new SentenceAssembler();
  private readonly timer: ReturnType<typeof setInterval>;
  private web?: Output;
  private current: LiveState = "connecting";
  private lastBlocked = true;
  private readonly owners: LineOwners;
  /** The emotion each line asked for, until it ends. */
  private readonly feelings = new Map<string, { emotion?: string; intensity?: number; seat?: string; persona?: string; thought?: boolean }>();

  constructor(private readonly o: SpeechPlayerOptions) {
    this.owners = new LineOwners(o.persona);
    this.playback = new Playback(
      () => (o.session.running ? (this.web ??= o.session.webOutput()) : silent),
      {
        started: (id, seat) => {
          o.session.lipsync?.unmute();
          o.timer?.heard(id, performance.now());
          const f = this.feelings.get(id);
          o.onEmotion?.(f?.emotion, f?.intensity, "start", f ? { id, seat: f.seat, persona: f.persona, ...(f.thought ? { thought: true } : {}) } : undefined);
          this.report(make("speech_started", { utterance_id: id, ...(seat ? { seat_id: seat } : {}) }), `started:${id}`);
          this.lifecycle({ type: "speech_started", utterance_id: id }, seat ?? f?.seat);
        },
        finished: (id) => {
          const seat = this.feelings.get(id)?.seat;
          this.endFeeling(id);
          const timing = o.timer?.take(id);
          this.report(make("speech_finished", { utterance_id: id, ...(timing ? { timing } : {}) }), `finished:${id}`);
          this.lifecycle({ type: "speech_finished", utterance_id: id }, seat);
        },
        interrupted: (id, reason) => {
          const seat = this.feelings.get(id)?.seat;
          this.endFeeling(id);
          o.session.lipsync?.mute(); // the node's own smoothing takes ~200 ms to close the mouth; a cut-off should look instant
          this.report(make("speech_interrupted", { utterance_id: id, reason }), `interrupted:${id}`);
          this.lifecycle({ type: "speech_interrupted", utterance_id: id, reason }, seat);
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

  /** What a human said for a seat, handed to the hub for that seat's driver (VIK-69, ADR-0024). False if the hub is not connected. */
  sendHumanUtterance(speech: { seat_id: string; text: string; final?: boolean }): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(make("human_utterance", speech)));
    return true;
  }

  /** Ask the game to pause, play or step (VIK-135). False if the hub is not connected. */
  sendTransport(action: "pause" | "play" | "step"): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(make("transport", { action })));
    return true;
  }

  /** Ask the table to voice one seat's thoughts, every seat's, or none (VIK-98). False if the hub is not connected. */
  sendListen(mode: "seat" | "all" | "off", seat?: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(make("listen", { mode, ...(seat !== undefined ? { seat_id: seat } : {}) })));
    return true;
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
      ws.send(JSON.stringify(make("hello", { role: "viewer", client: "vikaki-page", ...(this.o.persona ? { persona: this.o.persona } : {}), ...(this.o.sessionId ? { session_id: this.o.sessionId } : {}) })));
    };
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onclose = () => {
      this.state("disconnected");
      this.playback.cancelAll("cancelled"); // the driver's side is gone; do not keep talking
      this.o.onTurn?.(false, ""); // nor keep thinking
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
      case "utterance":
        this.owners.see(m.utterance_id, m.persona);
        if (!this.owners.mine(m.utterance_id)) break; // another persona's line: its own page plays it
        this.o.timer?.received(m.utterance_id, performance.now());
        this.o.onText?.({ id: m.utterance_id, seat: m.seat_id, ...(m.text !== undefined ? { text: m.text } : {}), ...(m.delta !== undefined ? { delta: m.delta } : {}), ...(m.to !== undefined ? { to: m.to } : {}), ...(m.thought ? { thought: true } : {}) });
        if (!this.feelings.has(m.utterance_id)) this.feelings.set(m.utterance_id, { emotion: m.emotion, intensity: m.intensity, seat: m.seat_id, persona: m.persona, ...(m.thought ? { thought: true } : {}) }); // the first message of a streamed line carries it
        break;
      case "react":
        if (this.owners.turnIsMine(m.persona)) this.o.onReact?.({ seat: m.seat_id, persona: m.persona, emotion: m.emotion, intensity: m.intensity, gesture: m.gesture, seconds: m.seconds ?? DEFAULT_REACT_SECONDS });
        break;
      case "thought":
        if (this.owners.turnIsMine(m.persona)) this.o.onThought?.({ seat: m.seat_id, persona: m.persona, text: m.text });
        break;
      case "table_state":
        this.o.onTableState?.(m);
        break;
      case "listen_state":
        this.o.onListenState?.(m.mode, m.seat_id);
        break;
      case "transport_state":
        this.o.onTransportState?.(m.paused);
        break;
      case "turn_started":
        if (this.owners.turnIsMine(m.persona)) this.o.onTurn?.(true, m.seat_id, m.persona);
        break;
      case "turn_ended":
        if (this.owners.turnIsMine(m.persona)) this.o.onTurn?.(false, m.seat_id, m.persona);
        break;
      case "audio": {
        if (!this.owners.mine(m.utterance_id)) break;
        const samples = decodePcm16(m.pcm);
        this.playback.push({
          utteranceId: m.utterance_id,
          seatId: m.seat_id,
          samples,
          sampleRate: m.sample_rate,
          final: m.final,
          sentenceIndex: m.sentence_index,
          sentenceText: m.sentence_text,
        });
        for (const done of this.sentences.push({ utteranceId: m.utterance_id, sentenceIndex: m.sentence_index, sentenceText: m.sentence_text, sentenceEnd: m.sentence_end, samples, sampleRate: m.sample_rate, final: m.final })) this.o.onSentence?.(done);
        break;
      }
      case "cancel":
        if (m.utterance_id === undefined || !this.owners.mine(m.utterance_id)) break; // the hub turns "cancel everything" into one cancel per utterance
        this.sentences.cancel(m.utterance_id);
        this.playback.cancel(m.utterance_id);
        break;
      default:
        break; // emotions, turns and the like are for later slices
    }
  }

  private endFeeling(id: string): void {
    this.owners.forget(id);
    const f = this.feelings.get(id);
    this.feelings.delete(id);
    if (f) this.o.onEmotion?.(f.emotion, f.intensity, "end", { id, seat: f.seat, persona: f.persona });
  }

  private lifecycle(event: SpeechEvent, seat: string | undefined): void {
    this.o.onLifecycle?.({ ...event, ...(seat ? { seat_id: seat } : {}) } as SpeechEvent);
  }

  private report(message: Message, what: string): void {
    this.o.onReport?.(what);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}
