import { encodePcm16, make, type Message } from "@vikaki/protocol";
import { SentenceChunker, type AudioChunk, type ChunkerOptions, type Tts } from "@vikaki/tts";
import type { Hub } from "./hub.ts";

export interface SpeechTiming {
  utterance_id: string;
  /** When the first text for this utterance reached the engine. */
  textAt: number;
  /** When the first audio for it was ready to send. */
  firstAudioAt: number;
}

export interface SpeechOptions {
  tts: Tts;
  /** Longest slice of audio sent in one message, in seconds. */
  maxSliceSeconds?: number;
  /** An utterance streamed in deltas that goes quiet this long is finished off. */
  idleFlushMs?: number;
  /** Map a persona name to a voice id. By default the persona name itself is passed; engines ignore unknown voices. */
  voiceFor?: (persona: string | undefined) => string | undefined;
  chunker?: ChunkerOptions;
  /** The voice used when a persona names none. Only shown to clients; the engine decides what it means. */
  defaultVoice?: string;
  /** Called once per utterance when its first audio is ready. Used to measure time to first audio. */
  onTiming?: (timing: SpeechTiming) => void;
}

interface Utterance {
  id: string;
  seatId: string;
  persona?: string;
  chunker: SentenceChunker;
  controller: AbortController;
  textAt: number;
  seq: number;
  rate: number;
  spoken: boolean;
  closed: boolean;
  cancelled: boolean;
  /** No avatar page was connected when speech began, so playback is simulated in real time. */
  virtual: boolean;
  virtualStart: number;
  virtualSeconds: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

type Job = { u: Utterance; text: string } | { u: Utterance; end: true };

const TOMBSTONES = 500;

function sleepUntil(at: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wait = at - Date.now();
    if (wait <= 0 || signal.aborted) return resolve();
    const t = setTimeout(done, wait);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Turns the driver's utterances into speech: chunk the text, synthesize each piece in order, send
 * audio to the avatar pages, and keep the driver informed. Speaks one utterance at a time (ADR-0001).
 */
export class SpeechEngine {
  private hub?: Hub;
  private readonly utterances = new Map<string, Utterance>();
  private readonly cancelled = new Set<string>(); // ids to ignore if the driver keeps streaming after a cancel
  private jobs: Job[] = [];
  private busy = false;
  private readonly maxSlice: number;
  private readonly idleMs: number;

  constructor(private readonly o: SpeechOptions) {
    this.maxSlice = o.maxSliceSeconds ?? 1;
    this.idleMs = o.idleFlushMs ?? 15_000;
  }

  attach(hub: Hub): void {
    this.hub = hub;
  }

  /** Feed the driver's messages in here. */
  handle(message: Message): void {
    if (message.type === "utterance") this.onUtterance(message);
    else if (message.type === "cancel") this.cancel(message.utterance_id, "cancelled", false);
  }

  /** The driver left: stop everything it had in flight. */
  driverGone(): void {
    for (const id of [...this.utterances.keys()]) this.cancel(id, "driver_disconnected", true);
  }

  // ---- intake ----

  private onUtterance(m: Extract<Message, { type: "utterance" }>): void {
    if (this.cancelled.has(m.utterance_id)) return; // a driver may keep streaming after cancelling
    let u = this.utterances.get(m.utterance_id);
    if (u?.closed) {
      this.hub?.toDriver(make("error", { code: "bad_message", message: `utterance ${m.utterance_id} is already complete`, utterance_id: m.utterance_id }));
      return;
    }
    if (!u) {
      u = {
        id: m.utterance_id,
        seatId: m.seat_id,
        persona: m.persona,
        chunker: new SentenceChunker(this.o.chunker),
        controller: new AbortController(),
        textAt: Date.now(),
        seq: 0,
        rate: 24000,
        spoken: false,
        closed: false,
        cancelled: false,
        virtual: false,
        virtualStart: 0,
        virtualSeconds: 0,
      };
      this.utterances.set(u.id, u);
    }

    const pieces = m.text !== undefined ? u.chunker.push(m.text) : u.chunker.push(m.delta!);
    const done = m.text !== undefined || m.final === true;
    if (done) pieces.push(...u.chunker.flush());
    for (const text of pieces) this.jobs.push({ u, text });
    if (done) this.finishIntake(u);
    else this.armIdle(u);
    void this.pump();
  }

  private finishIntake(u: Utterance): void {
    u.closed = true;
    clearTimeout(u.idleTimer);
    this.jobs.push({ u, end: true });
  }

  private armIdle(u: Utterance): void {
    clearTimeout(u.idleTimer);
    u.idleTimer = setTimeout(() => {
      if (u.closed || u.cancelled) return;
      for (const text of u.chunker.flush()) this.jobs.push({ u, text });
      this.finishIntake(u);
      void this.pump();
    }, this.idleMs);
  }

  // ---- cancel and failure ----

  /** `tellViewers` is true when the driver did not send the cancel itself (the hub relays the driver's own). */
  private cancel(id: string, reason: "cancelled" | "driver_disconnected", tellViewers: boolean): void {
    const u = this.utterances.get(id);
    if (!u || u.cancelled) return;
    u.cancelled = true;
    clearTimeout(u.idleTimer);
    u.controller.abort(); // wakes the engine and any simulated playback, so the queue moves on at once
    this.utterances.delete(id); // queued jobs of u are skipped when the worker reaches them
    this.cancelled.add(id);
    if (this.cancelled.size > TOMBSTONES) this.cancelled.delete(this.cancelled.values().next().value as string);
    if (tellViewers) this.hub?.toViewers(make("cancel", { utterance_id: id }));
    // With no avatar page connected, the engine is the one playing, so it reports the interruption.
    if (u.virtual && u.spoken) this.hub?.toDriver(make("speech_interrupted", { utterance_id: id, reason }));
  }

  private fail(u: Utterance, err: unknown): void {
    const code = (err as { code?: string })?.code === "tts_failed" ? "tts_failed" : "internal";
    this.hub?.toDriver(make("error", { code, message: (err as Error)?.message ?? "speech failed", utterance_id: u.id }));
    this.cancel(u.id, "cancelled", true);
  }

  // ---- the speaking queue ----

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        if (job.u.cancelled) continue;
        try {
          if ("end" in job) await this.end(job.u);
          else await this.speak(job.u, job.text);
        } catch (err) {
          if (!job.u.cancelled) this.fail(job.u, err);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async speak(u: Utterance, text: string): Promise<void> {
    const voice = this.o.voiceFor ? this.o.voiceFor(u.persona) : u.persona;
    for await (const chunk of this.o.tts.synthesize({ text, voice, signal: u.controller.signal })) {
      if (u.cancelled) return;
      this.emit(u, chunk);
    }
  }

  private emit(u: Utterance, chunk: AudioChunk): void {
    if (chunk.samples.length === 0) return;
    if (!u.spoken) {
      u.spoken = true;
      u.virtual = (this.hub?.viewerCount ?? 0) === 0;
      this.o.onTiming?.({ utterance_id: u.id, textAt: u.textAt, firstAudioAt: Date.now() });
      if (u.virtual) {
        u.virtualStart = Date.now();
        this.hub?.toDriver(make("speech_started", { utterance_id: u.id, seat_id: u.seatId }));
      }
    }
    u.rate = chunk.sampleRate;
    u.virtualSeconds += chunk.samples.length / chunk.sampleRate;
    if (u.virtual) return; // nobody to send audio to
    const step = Math.max(1, Math.round(this.maxSlice * chunk.sampleRate));
    for (let at = 0; at < chunk.samples.length; at += step) {
      this.hub?.toViewers(
        make("audio", {
          utterance_id: u.id,
          seat_id: u.seatId,
          seq: u.seq++,
          sample_rate: chunk.sampleRate,
          pcm: encodePcm16(chunk.samples.subarray(at, at + step)),
          final: false,
        }),
      );
    }
  }

  private async end(u: Utterance): Promise<void> {
    if (!u.spoken) {
      // Nothing to say (empty text). Report it as spoken so the driver is not left waiting.
      this.hub?.toDriver(make("speech_started", { utterance_id: u.id, seat_id: u.seatId }));
      this.hub?.toDriver(make("speech_finished", { utterance_id: u.id }));
      this.utterances.delete(u.id);
      return;
    }
    if (u.virtual) {
      await sleepUntil(u.virtualStart + u.virtualSeconds * 1000, u.controller.signal);
      if (u.cancelled) return;
      this.hub?.toDriver(make("speech_finished", { utterance_id: u.id }));
    } else {
      this.hub?.toViewers(make("audio", { utterance_id: u.id, seat_id: u.seatId, seq: u.seq++, sample_rate: u.rate, pcm: "", final: true }));
    }
    this.utterances.delete(u.id);
  }
}
