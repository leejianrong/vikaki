// The messages between an embedded avatar page and the page that frames it (VIK-66, ADR-0020). Pure: it is given the windows, so a test can
// drive it with plain objects. The rules, which are the whole security story:
//   - Nothing is posted, and nothing is accepted, unless the host named its own origin (`?parent=`). No parent, no messages.
//   - Posts go to that origin and no other (never `*`): if the page is framed by anyone else the browser drops them.
//   - Incoming messages count only when they come from the parent window itself AND from that origin.
//   - Where the browser says who the ancestor is (`location.ancestorOrigins`), it must agree with `?parent=`.

/**
 * A line's life as the page plays it (VIK-67): the same three events the page reports to the hub, with the seat that spoke. `reason` is only
 * on an interruption (`cancelled`, `human_spoke`, ...).
 */
export type SpeechEvent =
  | { type: "speech_started"; utterance_id: string; seat_id?: string }
  | { type: "speech_finished"; utterance_id: string; seat_id?: string }
  | { type: "speech_interrupted"; utterance_id: string; seat_id?: string; reason?: string };

/** What the page tells the host. `audio_locked` while the browser blocks sound, `audio_unlocked` once it does not, and the speech events. */
export type ToParent = { type: "audio_locked" } | { type: "audio_unlocked" } | SpeechEvent;
/** What the host may say. `unlock` after a click on the host page; `audio_status` asks the page to say where it stands (a host that attached its listener late). */
export type FromParent = { type: "unlock" } | { type: "audio_status" } | ({ type: "human_utterance" } & HumanSpeech);

/**
 * The messages a game may rely on (VIK-132, docs/embed.md "Stability"). Within a major version they only grow: a type is never renamed or
 * removed and a field never changes meaning. `satisfies` makes the compiler fail if a union gains a type this list lacks, and a test pins it.
 */
export const EMBED_TO_PARENT = ["audio_locked", "audio_unlocked", "speech_started", "speech_finished", "speech_interrupted"] as const satisfies readonly ToParent["type"][];
export const EMBED_FROM_PARENT = ["unlock", "audio_status", "human_utterance"] as const satisfies readonly FromParent["type"][];

/** What a human said for a seat, as the host's recogniser heard it (VIK-69, ADR-0024). `final: false` is a partial transcript. */
export interface HumanSpeech {
  seat_id: string;
  text: string;
  final?: boolean;
}

/**
 * A bare http(s) origin, as `new URL(x).origin` prints it, else undefined. `*`, paths, wrong schemes and other near misses are refused, so the
 * parameter cannot be used to widen who is talked to.
 */
export function parseParentOrigin(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.origin === value ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

export interface BridgeOptions {
  /** The host's origin from `?parent=`, already parsed. */
  parentOrigin: string | undefined;
  /** The window that frames this page. */
  parent: { postMessage(message: unknown, targetOrigin: string): void } | null;
  /** The origin the browser says the framing window has, where it says (Chrome and Safari). */
  ancestorOrigin?: string;
  /** The host said `unlock`: try to start audio. */
  onUnlock(): void;
  /** The host sent what a human said for a seat. Only called with a well-formed one. */
  onHumanUtterance?(speech: HumanSpeech): void;
  /** Whether the browser blocks sound right now; undefined while that is not known yet (the audio context is not made). */
  isLocked(): boolean | undefined;
}

export class EmbedBridge {
  /** False when messages are off: no parent named, nobody to talk to, or the browser's idea of the ancestor disagrees. */
  readonly active: boolean;
  private last: "audio_locked" | "audio_unlocked" | undefined;

  constructor(private readonly o: BridgeOptions) {
    this.active = o.parentOrigin !== undefined && o.parent !== null && (o.ancestorOrigin === undefined || o.ancestorOrigin === o.parentOrigin);
  }

  /** Tell the host where audio stands, when it has changed (or `again`, when the host asked). */
  report(again = false): void {
    if (!this.active) return;
    const locked = this.o.isLocked();
    if (locked === undefined) return;
    const type = locked ? "audio_locked" : "audio_unlocked";
    if (type === this.last && !again) return;
    this.last = type;
    this.o.parent!.postMessage({ type } satisfies ToParent, this.o.parentOrigin!);
  }

  /** Tell the host how a line is going: to the named origin only, and only if messages are on. Returns whether it was sent. */
  send(event: SpeechEvent): boolean {
    if (!this.active) return false;
    this.o.parent!.postMessage(event satisfies ToParent, this.o.parentOrigin!);
    return true;
  }

  /** A `message` event. Returns true if it was an accepted message from the host. */
  handle(e: { origin: string; source: unknown; data: unknown }): boolean {
    if (!this.active || e.origin !== this.o.parentOrigin || e.source !== this.o.parent) return false;
    const type = (e.data as { type?: unknown } | null)?.type;
    if (type === "unlock") {
      this.o.onUnlock();
      return true;
    }
    if (type === "audio_status") {
      this.report(true);
      return true;
    }
    if (type === "human_utterance") {
      const d = e.data as { seat_id?: unknown; text?: unknown; final?: unknown };
      if (typeof d.seat_id !== "string" || typeof d.text !== "string" || d.text === "" || (d.final !== undefined && typeof d.final !== "boolean")) return false;
      this.o.onHumanUtterance?.({ seat_id: d.seat_id, text: d.text, ...(d.final !== undefined ? { final: d.final } : {}) });
      return true;
    }
    return false;
  }
}
