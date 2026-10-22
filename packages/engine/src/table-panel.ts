// The spectator panel beside the 3D table (VIK-83): the pot, the street and the board, then one card per seat with its two hole cards, the hand
// in words, its chance to win as a bar, its stack, its bet and what it did last. Like the overlay it draws only what `table_state` carries and
// knows no poker: the words and the odds are the game's, sent when the table may see the cards. Plain DOM with roles and names for tests.
import type { MessageOf } from "@vikaki/protocol";
import { addActivity, type ActivityItem } from "./activity.ts";
import { makeResizable } from "./panel-resize.ts";
import { cardEl, chipIcon } from "./table-overlay.ts";
import { addToTranscript, CHAT_LINES, favourite, lineLabel, percent, seatColour, type Seat, type TranscriptLine } from "./table.ts";
import { el } from "./ui/dom.ts";
import "./ui/material.ts";
import "./ui/table.css";

type State = MessageOf<"table_state">;

const label = (s: Seat) => s.persona ?? s.seat;
const money = (n: number) => n.toLocaleString("en-US");

export class TablePanel {
  private readonly root = el("aside", { className: "side-sheet table-panel", ariaLabel: "Table panel" });
  private readonly head = el("section", { className: "panel-head", ariaLabel: "Board" });
  private readonly strip = el("section", { className: "players-strip", ariaLabel: "Players" });
  private readonly activity = el("div", { className: "activity", role: "log", ariaLabel: "Activity", tabIndex: 0 });
  private items: ActivityItem[] = [];
  private lastEventState: State | undefined;
  private readonly tabs: { tab: HTMLElement; panel: HTMLElement }[] = [];
  /** The camera shots (VIK-95): Wide, Overhead, and a close-up of each player. */
  private readonly cameraButtons = new Map<string, HTMLButtonElement>();
  private readonly cameras = el("div", { className: "cameras", role: "toolbar", ariaLabel: "Camera" });
  private onCamera: (shot: string) => void = () => {};
  private readonly directorButton = el("button", { type: "button", className: "camera director", textContent: "Auto", ariaLabel: "Auto director (D)" });
  private onDirector: (on: boolean) => void = () => {};
  /** Listening in (VIK-98): one button on each player's card, and a switch for every seat's thoughts. */
  private readonly listenButtons: HTMLButtonElement[];
  private readonly hearAll = el("input", { type: "checkbox", role: "switch", ariaLabel: "Hear every thought", checked: true });
  private listenState: { mode: "seat" | "all" | "off"; seat?: string } = { mode: "all" };
  private onListen: (mode: "seat" | "all" | "off", seat?: string) => void = () => {};
  private readonly cards: HTMLElement[];
  private readonly chat = el("div", { className: "chat", role: "log", ariaLabel: "Chat", tabIndex: 0 });
  private lines: TranscriptLine[] = [];
  private readonly thoughts = el("div", { className: "chat thoughts", role: "log", ariaLabel: "Thoughts", tabIndex: 0 });
  private thoughtLines: { seat: string; text: string }[] = [];

  constructor(private readonly seats: Seat[], parent: HTMLElement = document.body) {
    this.cards = seats.map((s) => el("section", { className: "seat-card", role: "group", ariaLabel: `${label(s)}, hand` }));
    this.listenButtons = seats.map((s) => {
      const b = el("button", { type: "button", className: "listen-in", textContent: "Listen in", ariaLabel: `Listen in to ${label(s)}` });
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => this.chooseSeat(s.seat));
      return b;
    });
    const shots: [string, string, string][] = [["wide", "Wide", "Wide shot (1)"], ["overhead", "Overhead", "Overhead shot (2)"], ...seats.map((s, i): [string, string, string] => [`seat:${i}`, label(s), `Close-up of ${label(s)}${i < 7 ? ` (${i + 3})` : ""}`]), ["board", "Board", "Board shot (B)"], ["grid", "Grid", "POV grid shot (G)"], ...seats.map((s, i): [string, string, string] => [`pov:${i}`, `POV ${label(s)}`, `Point of view of ${label(s)}`])];
    for (const [id, text, name] of shots) {
      const b = el("button", { type: "button", className: "camera", textContent: text, ariaLabel: name });
      b.setAttribute("aria-pressed", String(id === "wide"));
      b.addEventListener("click", () => this.onCamera(id));
      this.cameraButtons.set(id, b);
      this.cameras.append(b);
    }
    this.directorButton.setAttribute("aria-pressed", "true");
    this.directorButton.addEventListener("click", () => this.toggleDirector());
    this.cameras.append(this.directorButton);
    this.hearAll.addEventListener("change", () => this.onListen(this.hearAll.checked ? "all" : "off"));
    // One column (VIK-138): the players in a compact strip, the activity log, then Chat and Thoughts as tabs.
    this.strip.append(...this.cards);
    const chatTab = this.makeTab("Chat", this.chat, true);
    const thoughtsTab = this.makeTab("Thoughts", this.thoughts, false);
    this.tabs.push(chatTab, thoughtsTab);
    const tablist = el("div", { className: "tabs", role: "tablist", ariaLabel: "Chat and thoughts" }, chatTab.tab, thoughtsTab.tab);
    tablist.addEventListener("keydown", (e) => {
      const at = this.tabs.findIndex((t) => t.tab === document.activeElement);
      if (at < 0 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      e.preventDefault();
      const to = this.tabs[(at + (e.key === "ArrowRight" ? 1 : this.tabs.length - 1)) % this.tabs.length]!;
      this.select(to.tab);
      to.tab.focus();
    });
    const listening = el("section", { className: "listening", role: "group", ariaLabel: "Listening in" }, el("label", {}, this.hearAll, " Hear every thought"));
    this.root.append(this.cameras, this.head, this.strip, el("h2", { className: "title-medium", textContent: "Activity" }), this.activity, tablist, chatTab.panel, thoughtsTab.panel, listening);
    document.body.classList.add("has-panel", "has-table-panel");
    parent.append(this.root);
    makeResizable();
    this.draw();
  }

  setState(state: State): void {
    this.draw(state);
  }

  /** What to do when a camera button is pressed (VIK-95). */
  setCameraHandler(f: (shot: string) => void): void {
    this.onCamera = f;
  }

  setDirectorHandler(f: (on: boolean) => void): void {
    this.onDirector = f;
  }

  /** Mark whether the auto-director is on. */
  setDirector(on: boolean): void {
    this.directorButton.setAttribute("aria-pressed", String(on));
  }

  toggleDirector(): void {
    this.onDirector(this.directorButton.getAttribute("aria-pressed") !== "true");
  }

  /** Mark the shot that is on. */
  setCameraShot(shot: string): void {
    for (const [id, b] of this.cameraButtons) b.setAttribute("aria-pressed", String(id === shot));
  }

  /** What to do when the viewer picks a seat to listen to, every seat, or none (VIK-98). */
  setListenHandler(f: (mode: "seat" | "all" | "off", seat?: string) => void): void {
    this.onListen = f;
  }

  /** Clicking a player's button listens to that seat; clicking it again stops. */
  chooseSeat(seat: string): void {
    if (this.listenState.mode === "seat" && this.listenState.seat === seat) this.onListen("off");
    else this.onListen("seat", seat);
  }

  /** The table's choice, as the hub says it: marks the pressed button and the switch. */
  setListen(mode: "seat" | "all" | "off", seat?: string): void {
    this.listenState = { mode, ...(seat !== undefined ? { seat } : {}) };
    this.hearAll.checked = mode === "all";
    this.seats.forEach((s, i) => this.listenButtons[i]!.setAttribute("aria-pressed", String(mode === "seat" && seat === s.seat)));
    this.cards.forEach((c, i) => c.classList.toggle("spotlit", mode === "seat" && seat === this.seats[i]!.seat));
    this.strip.classList.toggle("listening-in", mode === "seat");
  }

  /** A state arrived (live, not a review): its beat goes in the activity log. */
  addActivity(state: State): void {
    const atEnd = this.activity.scrollHeight - this.activity.scrollTop - this.activity.clientHeight < 24;
    const next = addActivity(this.items, this.lastEventState, state);
    this.lastEventState = state;
    if (next === this.items) return;
    this.items = next;
    this.activity.replaceChildren(
      ...next.map((it) => {
        if (it.kind === "hand") return el("p", { className: "hand-sep" }, el("b", { textContent: it.text }), ...(it.detail ? [el("span", { textContent: it.detail })] : []));
        const i = it.seat ? this.seats.findIndex((x) => x.seat === it.seat) : -1;
        const p = el("p", { textContent: it.text });
        if (i >= 0) p.style.borderInlineStartColor = seatColour(i);
        return p;
      }),
    );
    if (atEnd) this.activity.scrollTop = this.activity.scrollHeight;
  }

  private makeTab(name: string, panel: HTMLElement, selected: boolean): { tab: HTMLElement; panel: HTMLElement } {
    const id = `tab-${name.toLowerCase()}`;
    const tab = el("button", { type: "button", role: "tab", id, ariaLabel: name, className: "tab" }, name, el("span", { className: "new-dot", hidden: true }));
    tab.setAttribute("aria-label", name);
    tab.setAttribute("aria-controls", `${id}-panel`);
    tab.addEventListener("click", () => this.select(tab));
    panel.id = `${id}-panel`;
    panel.setAttribute("aria-labelledby", id);
    panel.hidden = !selected;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    return { tab, panel };
  }

  private select(tab: HTMLElement): void {
    for (const t of this.tabs) {
      const on = t.tab === tab;
      t.tab.setAttribute("aria-selected", String(on));
      t.tab.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
      if (on) (t.tab.querySelector(".new-dot") as HTMLElement).hidden = true;
    }
  }

  /** A small dot on a tab that has something new while another tab is open. */
  private flag(panel: HTMLElement): void {
    const t = this.tabs.find((x) => x.panel === panel);
    if (t && t.panel.hidden) (t.tab.querySelector(".new-dot") as HTMLElement).hidden = false;
  }

  /** A mute switch and a volume slider for the sound effects (VIK-122), at the foot of the left column. */
  addSoundControls(sfx: { volume: number; muted: boolean; set(o: { volume?: number; muted?: boolean }): void }): void {
    const mute = el("input", { type: "checkbox", role: "switch", ariaLabel: "Mute sound effects", checked: sfx.muted });
    const volume = el("input", { type: "range", min: "0", max: "100", step: "5", value: String(Math.round(sfx.volume * 100)), ariaLabel: "Sound effects volume" });
    mute.addEventListener("change", () => sfx.set({ muted: mute.checked }));
    volume.addEventListener("input", () => sfx.set({ volume: Number(volume.value) / 100 }));
    this.root.append(el("section", { className: "sound-controls", role: "group", ariaLabel: "Sound effects" }, el("h2", { className: "title-medium", textContent: "Sound effects" }), el("label", {}, mute, " Mute"), el("label", {}, "Volume ", volume)));
  }

  /** A whole line or a piece of one (the same `id` grows it): wrapped in full, the name in the seat's colour, newest last and scrolled into view unless the reader has scrolled up. */
  addText(line: { id: string; seat: string; text?: string; delta?: string; to?: string }): void {
    this.lines = addToTranscript(this.lines, line, CHAT_LINES);
    const atEnd = this.chat.scrollHeight - this.chat.scrollTop - this.chat.clientHeight < 24;
    this.chat.replaceChildren(
      ...this.lines.map((l) => {
        const i = Math.max(0, this.seats.findIndex((s) => s.seat === l.seat));
        const who = el("b", { textContent: lineLabel(l, (id) => { const s = this.seats.find((x) => x.seat === id); return s ? label(s) : id; }) });
        who.style.color = seatColour(i);
        return el("p", {}, who, l.text);
      }),
    );
    if (atEnd) this.chat.scrollTop = this.chat.scrollHeight;
    this.flag(this.chat);
  }

  /** A private thought (VIK-93): shown here for the audience, in the seat's colour, and kept apart from what was said aloud. */
  addThought(seat: string, text: string): void {
    this.thoughtLines = [...this.thoughtLines, { seat, text }].slice(-CHAT_LINES);
    const atEnd = this.thoughts.scrollHeight - this.thoughts.scrollTop - this.thoughts.clientHeight < 24;
    this.thoughts.replaceChildren(
      ...this.thoughtLines.map((l) => {
        const i = Math.max(0, this.seats.findIndex((s) => s.seat === l.seat));
        const who = el("b", { textContent: this.seats[i] ? label(this.seats[i]!) : l.seat });
        who.style.color = seatColour(i);
        return el("p", {}, who, l.text);
      }),
    );
    if (atEnd) this.thoughts.scrollTop = this.thoughts.scrollHeight;
    this.flag(this.thoughts);
  }

  private draw(st?: State): void {
    this.head.replaceChildren();
    if (st?.board?.length) this.head.append(el("ul", { className: "cards board", ariaLabel: "Board" }, ...st.board.map(cardEl)));
    else this.head.append(el("p", { className: "hint", textContent: "No board yet" }));

    const lead = st ? favourite(st.seats) : undefined;
    this.seats.forEach((s, i) => {
      const card = this.cards[i]!;
      const row = st?.seats.find((x) => x.seat_id === s.seat);
      card.classList.toggle("folded", row?.folded === true);
      card.classList.toggle("lead", lead === s.seat);
      if (st?.turn === s.seat) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
      const kids: (Node | string)[] = [];
      const title = el("div", { className: "seat-title" }, el("span", { className: "name", textContent: label(s) }));
      if (st?.dealer === s.seat) title.append(el("span", { className: "badge", textContent: "D", ariaLabel: "Dealer" }));
      if (row) title.append(el("span", { className: "money", textContent: `Stack ${money(row.stack)}` }));
      kids.push(title);
      if (row?.cards?.length) kids.push(el("ul", { className: "cards", ariaLabel: "Cards" }, ...row.cards.map(cardEl)));
      if (row?.hand) kids.push(el("p", { className: "hand-name", textContent: row.hand }));
      if (row?.win !== undefined) {
        const pct = Math.round(row.win * 100);
        const bar = el("div", { className: "meter", role: "meter", ariaLabel: `${label(s)} chance to win` });
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", String(pct));
        bar.setAttribute("aria-valuetext", percent(row.win));
        bar.append(el("span", { className: "fill" }));
        (bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
        kids.push(el("div", { className: "win-row" }, bar, el("span", { className: "pct", textContent: percent(row.win) })));
      }
      const notes = [row?.bet ? `Bet ${money(row.bet)}` : "", row?.folded ? "" : (row?.action ?? ""), row?.folded ? "Folded" : ""].filter(Boolean);
      if (notes.length) kids.push(el("p", { className: "note", textContent: notes.join(" · ") }));
      kids.push(this.listenButtons[i]!);
      card.replaceChildren(...kids);
    });
  }
}
