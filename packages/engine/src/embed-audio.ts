// Sound in an embedded page (VIK-66, ADR-0020). Browsers keep a page silent until the person has clicked on it, and a click on the page
// that frames this one does not count here. So, in embed mode: show a small "click for sound" button (a click in the frame always works),
// and speak to the host over `postMessage` (`embed-bridge.ts`) so it can unlock the sound from its own click.
import type { AudioSession } from "./audio-session.ts";
import type { EmbedOptions } from "./embed.ts";
import { EmbedBridge, parseParentOrigin, type HumanSpeech } from "./embed-bridge.ts";
import { el } from "./ui/dom.ts";
import "./ui/theme.css";
import "./ui/base.css";
import "./ui/embed.css";

export interface EmbedAudio {
  /** Show or hide the button and tell the host, if audio's state changed. Runs by itself a few times a second; tests call it. */
  sync(): void;
  readonly bridge: EmbedBridge;
  /** Where a human's speech from the host goes (VIK-69): the page sets it to its speech player's `sendHumanUtterance`. Dropped until set. */
  onHumanUtterance: ((speech: HumanSpeech) => void) | undefined;
}

/** Only in embed mode. `win` is for tests. */
export function mountEmbedAudio(o: { session: AudioSession; embed: EmbedOptions; params: URLSearchParams; win?: Window }): EmbedAudio | undefined {
  if (!o.embed.embed) return undefined;
  const win = o.win ?? window;
  const parentOrigin = parseParentOrigin(o.params.get("parent"));
  if (o.params.has("parent") && !parentOrigin) console.warn(`vikaki: ?parent= must be a bare origin such as https://game.example, not "${o.params.get("parent")}"; messages to the host are off`);
  /** Undefined until the audio context exists: before that the page cannot tell, and says nothing. */
  const locked = () => (o.session.state === "none" ? undefined : o.session.state === "suspended" || o.session.state === "interrupted");
  const pill = el("button", { type: "button", className: "sound-pill", hidden: true, textContent: "Click for sound" });
  // A click in the frame is a real gesture here: it always works.
  pill.addEventListener("click", () => void o.session.prepare().catch(() => {}));
  document.body.append(pill);
  const hooks: { onHumanUtterance: EmbedAudio["onHumanUtterance"] } = { onHumanUtterance: undefined };
  const bridge = new EmbedBridge({
    parentOrigin,
    parent: win.parent !== win ? win.parent : null,
    ancestorOrigin: win.location.ancestorOrigins?.[0],
    onUnlock: () => void o.session.prepare().catch(() => {}),
    isLocked: locked,
    onHumanUtterance: (speech) => hooks.onHumanUtterance?.(speech),
  });
  win.addEventListener("message", (e) => bridge.handle(e));
  let told = false;
  const sync = () => {
    pill.hidden = locked() !== true;
    if (locked() === true && !told) {
      told = true;
      console.info(`vikaki: the browser blocks sound until the page is clicked. Click "Click for sound"${bridge.active ? ` or send {type:"unlock"} from ${parentOrigin} after a click there` : " (add ?parent=<your origin> to unlock it from the host page)"}.`);
    }
    bridge.report();
  };
  // The browser can start allowing sound at any moment, with no event the page can listen to (see SpeechPlayer's timer).
  setInterval(sync, 100);
  return {
    sync,
    bridge,
    get onHumanUtterance() {
      return hooks.onHumanUtterance;
    },
    set onHumanUtterance(fn) {
      hooks.onHumanUtterance = fn;
    },
  };
}
