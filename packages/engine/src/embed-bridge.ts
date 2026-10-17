// The messages between an embedded avatar page and the page that frames it (VIK-66, ADR-0020). Pure: it is given the windows, so a test can
// drive it with plain objects. The rules, which are the whole security story:
//   - Nothing is posted, and nothing is accepted, unless the host named its own origin (`?parent=`). No parent, no messages.
//   - Posts go to that origin and no other (never `*`): if the page is framed by anyone else the browser drops them.
//   - Incoming messages count only when they come from the parent window itself AND from that origin.
//   - Where the browser says who the ancestor is (`location.ancestorOrigins`), it must agree with `?parent=`.

/** What the page tells the host. `audio_locked` while the browser blocks sound, `audio_unlocked` once it does not. */
export type ToParent = { type: "audio_locked" } | { type: "audio_unlocked" };
/** What the host may say. `unlock` after a click on the host page; `audio_status` asks the page to say where it stands (a host that attached its listener late). */
export type FromParent = { type: "unlock" } | { type: "audio_status" };

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
  /** Whether the browser blocks sound right now; undefined while that is not known yet (the audio context is not made). */
  isLocked(): boolean | undefined;
}

export class EmbedBridge {
  /** False when messages are off: no parent named, nobody to talk to, or the browser's idea of the ancestor disagrees. */
  readonly active: boolean;
  private last: ToParent["type"] | undefined;

  constructor(private readonly o: BridgeOptions) {
    this.active = o.parentOrigin !== undefined && o.parent !== null && (o.ancestorOrigin === undefined || o.ancestorOrigin === o.parentOrigin);
  }

  /** Tell the host where audio stands, when it has changed (or `again`, when the host asked). */
  report(again = false): void {
    if (!this.active) return;
    const locked = this.o.isLocked();
    if (locked === undefined) return;
    const type: ToParent["type"] = locked ? "audio_locked" : "audio_unlocked";
    if (type === this.last && !again) return;
    this.last = type;
    this.o.parent!.postMessage({ type } satisfies ToParent, this.o.parentOrigin!);
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
    return false;
  }
}
