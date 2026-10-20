// The playback bar under the table (VIK-135): step back, pause or play, step forward, and where in the hand the page is. It draws what it is told and
// calls back when pressed; `table-page.ts` decides what each press means. Plain buttons with names, so tests find them the way a person would.
import { el } from "./ui/dom.ts";
import "./ui/table.css";

export interface TransportView {
  /** The game said it can be paused (`transport_state`), so the bar is shown. */
  available: boolean;
  /** The game is held (or the page is reviewing): the middle button offers Play. */
  paused: boolean;
  reviewing: boolean;
  /** The 1-based place being looked at, and how many states there are. */
  position: number;
  length: number;
}

export interface TransportActions {
  back(): void;
  toggle(): void;
  forward(): void;
}

export class TransportBar {
  readonly root = el("div", { className: "transport-bar", role: "toolbar", ariaLabel: "Playback", hidden: true });
  private readonly back = el("button", { type: "button", ariaLabel: "Step back", title: "Step back", textContent: "⏮" });
  private readonly toggle = el("button", { type: "button", className: "primary" });
  private readonly forward = el("button", { type: "button", ariaLabel: "Step forward", title: "Step forward", textContent: "⏭" });
  private readonly where = el("span", { className: "where", role: "status", ariaLabel: "Playback position" });

  constructor(actions: TransportActions) {
    this.back.addEventListener("click", actions.back);
    this.toggle.addEventListener("click", actions.toggle);
    this.forward.addEventListener("click", actions.forward);
    this.root.append(this.back, this.toggle, this.forward, this.where);
  }

  update(v: TransportView): void {
    this.root.hidden = !v.available;
    this.toggle.textContent = v.paused ? "▶" : "⏸";
    this.toggle.ariaLabel = this.toggle.title = v.paused ? "Play" : "Pause";
    this.back.disabled = v.position <= 1;
    this.forward.disabled = !v.paused && !v.reviewing;
    this.where.textContent = v.reviewing ? `Reviewing ${v.position} of ${v.length}` : v.paused ? "Paused" : "Live";
  }
}
