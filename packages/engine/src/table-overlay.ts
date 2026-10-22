// The table page's overlay (VIK-59): pot, board and street at the top, a plate under each avatar (name, stack, bet, cards, dealer button,
// turn marker), and a transcript strip. It draws the last `table_state` and the lines it is told of, and holds no game logic: what the
// plates say is what the game sent. Plain DOM with roles and names, so tests find things the way a person would.
import type { MessageOf } from "@vikaki/protocol";
import type { EmbedOptions } from "./embed.ts";
import { addToTranscript, cardFace, SUIT_PATHS, lineLabel, seatColour, type Seat, type TranscriptLine } from "./table.ts";
import { classicFaceUrl, currentDeck } from "./card-art.ts";
import { el } from "./ui/dom.ts";
import "./ui/material.ts";
import "./ui/table.css";

type State = MessageOf<"table_state">;

const label = (s: Seat) => s.persona ?? s.seat;
const money = (n: number) => n.toLocaleString("en-US");

/** How long a speech bubble stays after its line's last piece (ms). */
export const BUBBLE_MS = 4000;

/** How long a beat's banner stays (ms), by kind. A showdown and a win stay until the next beat replaces them. */
export const BEAT_MS: Record<string, number | undefined> = { new_hand: 2300, street: 2300, showdown: undefined, win: undefined };
const BEAT_DEFAULT_MS = 1900;
/** The beats that are a title card for the table, not one seat's move. */
const TITLES = new Set(["new_hand", "street", "showdown", "win"]);

/** A suit as an inline SVG (VIK-141): a shape, not a font glyph, so the spade and the club cannot be mistaken for each other. */
function pipSvg(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "pip");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

/** A poker chip as an inline SVG, next to the pot's amount (VIK-141): a ring of dashes round a disc, in the text's colour. */
export function chipIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "chip-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<circle cx="12" cy="12" r="10.5" fill="currentColor"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="var(--chip-ring, #fff)" stroke-width="1.6" stroke-dasharray="3.2 2.1"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="var(--chip-ring, #fff)" stroke-width="1.2"/>';
  return svg;
}

/** The little picture beside a move's words in the banner (VIK-136): a knuckle for a check, chips pushed for a call, bet or raise, a card slid away for a fold. */
const MOVE_ICONS: Record<string, string> = {
  check: '<rect x="5" y="9" width="14" height="9" rx="3" fill="currentColor"/><path d="M8 9V6m4 3V5m4 4V6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  call: '<circle cx="9" cy="14" r="5" fill="currentColor"/><path d="M16 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  bet: '<circle cx="8" cy="14" r="5" fill="currentColor"/><circle cx="11" cy="9" r="5" fill="currentColor" opacity=".6"/><path d="M16 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  fold: '<rect x="5" y="6" width="10" height="13" rx="2" fill="currentColor"/><path d="M17 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};
MOVE_ICONS.raise = MOVE_ICONS.bet!;

export function moveIcon(kind: string): SVGSVGElement | undefined {
  const body = MOVE_ICONS[kind];
  if (!body) return undefined;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `move-icon icon-${kind}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = body;
  return svg;
}

export function cardEl(card: string): HTMLElement {
  const f = cardFace(card);
  const classic = currentDeck() === "classic" ? classicFaceUrl(card) : undefined;
  if (classic) {
    // The classic look (VIK-115): the whole card is a picture, with the same name for a reader and for tests.
    const img = el("img", { src: classic, alt: "", draggable: false });
    return el("li", { className: `card classic${f.red ? " red" : ""}`, ariaLabel: f.text }, img);
  }
  const path = SUIT_PATHS[f.suit];
  const pip = path ? [pipSvg(path)] : [];
  return el("li", { className: `card${f.red ? " red" : ""}${f.down ? " down" : ""}`, ariaLabel: f.down ? "face-down card" : f.text }, ...(path ? [el("span", { className: "rank", textContent: f.rank }), ...pip] : [f.text]));
}

export class TableOverlay {
  private readonly root = el("div", { className: "table-overlay" });
  private readonly info = el("section", { className: "table-info", ariaLabel: "Table", hidden: true });
  private readonly plates: HTMLElement[];
  private readonly log = el("div", { className: "transcript", role: "log", ariaLabel: "Transcript" });
  private readonly bubbles: HTMLElement[];
  private readonly marks: HTMLElement[];
  private readonly beat = el("div", { className: "beat", role: "status", ariaLabel: "Last move", hidden: true });
  private beatTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly bubbleTimers: (ReturnType<typeof setTimeout> | undefined)[];
  private lines: TranscriptLine[] = [];
  private state: State | undefined;
  /** False when the cards are drawn on a 3D table: a plate then says only name, stack and bet. */
  showCards = true;

  /** In embed mode (VIK-64) the pot strip is never drawn, and the plates and transcript only when asked for. */
  /** With the spectator panel beside the table (VIK-83) the pot, street and board are in the panel, so the strip at the top is not drawn twice. */
  /** Put something over the stage (the playback bar, VIK-135). */
  mount(node: HTMLElement): void {
    this.root.append(node);
  }

  set withPanel(on: boolean) {
    this.root.classList.toggle("with-panel", on);
  }

  constructor(private readonly seats: Seat[], parent: HTMLElement = document.body, embed?: Pick<EmbedOptions, "embed" | "names" | "captions">) {
    if (embed?.embed) {
      this.root.classList.add("embed");
      this.root.classList.toggle("names", embed.names);
      this.root.classList.toggle("captions", embed.captions);
    }
    this.plates = seats.map((s) => el("div", { className: "seat-plate", role: "group", ariaLabel: label(s) }));
    this.plates.forEach((p, i) => p.addEventListener("click", () => this.onSelect?.(seats[i]!.seat)));
    this.bubbles = seats.map((s, i) => {
      const b = el("p", { className: "bubble", hidden: true, ariaLabel: `${label(s)} says` });
      b.style.setProperty("--seat-colour", seatColour(i));
      return b;
    });
    this.bubbleTimers = seats.map(() => undefined);
    this.marks = seats.map((s, i) => {
      const m = el("span", { className: "thought-mark", hidden: true, textContent: "…", ariaLabel: `${label(s)} has a thought` });
      m.style.setProperty("--seat-colour", seatColour(i));
      return m;
    });
    this.root.append(this.info, ...this.plates, ...this.bubbles, ...this.marks, this.beat, this.log, this.povCaption);
    parent.append(this.root);
    this.draw();
  }

  /** Put each seat's plate under its avatar: `xs` are the avatars' centres in pixels from the left edge. `tops`, when known, are the pixels from the top edge of the heads: a bubble sits just above. */
  place(xs: number[], tops?: number[]): void {
    this.plates.forEach((p, i) => {
      if (xs[i] !== undefined) p.style.left = `${Math.round(xs[i]!)}px`;
    });
    this.marks.forEach((m, i) => {
      if (xs[i] !== undefined) m.style.left = `${Math.round(xs[i]!)}px`;
      if (tops?.[i] !== undefined) m.style.top = `${Math.round(tops[i]!)}px`;
    });
    // A bubble is up to 240 px wide and centred on its head: keep it inside the stage when the table is squeezed (VIK-111).
    const stage = this.root.clientWidth;
    this.bubbles.forEach((b, i) => {
      if (xs[i] !== undefined) b.style.left = `${Math.round(stage > 260 ? Math.min(stage - 130, Math.max(130, xs[i]!)) : xs[i]!)}px`;
      if (tops?.[i] !== undefined) b.style.top = `${Math.round(tops[i]!)}px`;
    });
  }

  setState(state: State): void {
    this.state = state;
    this.draw();
    this.showBeat(state.event);
  }

  private readonly gridTiles: HTMLElement[] = [];
  private gridSpot: string | undefined;

  /** The POV grid (VIK-100): a labelled frame over each tile the canvas draws, the listened-to seat's highlighted. `undefined` takes the grid away. */
  setGrid(tiles: { x: number; y: number; width: number; height: number }[] | undefined): void {
    this.root.classList.toggle("grid", tiles !== undefined);
    this.gridTiles.forEach((t) => (t.hidden = true));
    if (!tiles) return;
    tiles.forEach((r, i) => {
      let t = this.gridTiles[i];
      if (!t) {
        const seat = this.seats[i]!;
        t = el("div", { className: "pov-tile", role: "group", ariaLabel: `Point of view of ${label(seat)}` }, el("span", { className: "pov-label", textContent: label(seat) }));
        this.gridTiles[i] = t;
        this.root.append(t);
      }
      t.hidden = false;
      Object.assign(t.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      t.classList.toggle("spotlit", this.seats[i]!.seat === this.gridSpot);
    });
  }

  /** Highlight the seat's tile (the one being listened to). */
  setGridSpot(seat: string | undefined): void {
    this.gridSpot = seat;
    this.gridTiles.forEach((t, i) => t.classList.toggle("spotlit", this.seats[i]?.seat === seat));
  }

  private povSeat: string | undefined;
  private readonly povCaption = el("p", { className: "pov-caption", role: "status", ariaLabel: "Thought", hidden: true });
  private readonly lastThought = new Map<string, string>();

  /** The camera is at a player's eyes (VIK-99): a soft vignette and cooler colours, and their latest thought as a caption. */
  setPov(seat: string | undefined): void {
    this.povSeat = seat;
    this.root.classList.toggle("pov", seat !== undefined);
    this.showCaption();
  }

  /** A seat thought something (VIK-99): kept, and shown while the camera is at that seat's eyes. */
  setPovCaption(seat: string, text: string): void {
    this.lastThought.set(seat, text);
    this.showCaption();
  }

  private showCaption(): void {
    const text = this.povSeat !== undefined ? this.lastThought.get(this.povSeat) : undefined;
    this.povCaption.hidden = text === undefined;
    if (text !== undefined) this.povCaption.textContent = text;
  }

  /** In a close-up of one player (VIK-95) the name plates would sit over the face, so they are put away. */
  setCloseUp(on: boolean): void {
    this.root.classList.toggle("close-up", on);
  }

  /** Called with a seat when its plate is clicked (VIK-98). */
  onSelect?: (seat: string) => void;

  /** Spotlight one seat's plate while its thoughts are listened to or spoken (VIK-98): the others dim. `undefined` puts every plate back. */
  setSpotlight(seat: string | undefined): void {
    this.plates.forEach((p, i) => {
      p.classList.toggle("spotlit", seat !== undefined && this.seats[i]!.seat === seat);
      p.classList.toggle("dim", seat !== undefined && this.seats[i]!.seat !== seat);
    });
  }

  /** The banner for the beat just played ("Ben raises to 12"), and a pulse on the acting seat's plate. The words are the game's. */
  private showBeat(event: State["event"]): void {
    if (!event) return;
    clearTimeout(this.beatTimer);
    const i = this.seats.findIndex((s) => s.seat === event.seat_id);
    this.beat.className = `beat ${TITLES.has(event.kind) ? "title" : "move"} kind-${event.kind.replace(/[^a-z_-]/g, "")}`;
    this.beat.style.setProperty("--seat-colour", i >= 0 ? seatColour(i) : "var(--md-sys-color-primary)");
    const icon = moveIcon(event.kind);
    this.beat.replaceChildren(...(icon ? [icon] : []), event.text, ...(event.detail ? [el("span", { className: "detail", textContent: event.detail })] : []));
    this.beat.hidden = false;
    const stays = event.kind in BEAT_MS && BEAT_MS[event.kind] === undefined;
    if (!stays) this.beatTimer = setTimeout(() => (this.beat.hidden = true), BEAT_MS[event.kind] ?? BEAT_DEFAULT_MS);
    const plate = i >= 0 ? this.plates[i] : undefined;
    if (plate && !TITLES.has(event.kind)) {
      plate.classList.remove("acted");
      void plate.offsetWidth; // restart the pulse
      plate.classList.add("acted");
    }
  }

  addText(line: { id: string; seat: string; text?: string; delta?: string; to?: string }): void {
    this.lines = addToTranscript(this.lines, line);
    const name = (seat: string) => {
      const s = this.seats.find((x) => x.seat === seat);
      return s ? label(s) : seat;
    };
    this.log.replaceChildren(...this.lines.map((l) => el("p", {}, el("b", { textContent: lineLabel(l, name) }), l.text)));
    const said = this.lines.find((l) => l.id === line.id);
    this.showBubble(line.seat, said?.text ?? "", said?.to ? name(said.to) : undefined);
  }

  /** A small mark over a seat that has a private thought (VIK-93): on when one arrives, off when that seat's next turn begins. */
  setThought(seat: string, on: boolean): void {
    const i = this.seats.findIndex((s) => s.seat === seat);
    if (i >= 0) this.marks[i]!.hidden = !on;
  }

  /** A seat thinks aloud (VIK-121): its bubble turns into a thought bubble, labelled "Thinking". It is not table talk, so the transcript is left alone. */
  addSpokenThought(seat: string, text: string): void {
    this.setThought(seat, true);
    this.showBubble(seat, text, undefined, true);
  }

  /** The speaker's bubble shows the line as far as it has arrived and fades some seconds after the last piece; no other seat keeps one. */
  private showBubble(seat: string, text: string, to?: string, thought = false): void {
    this.bubbles.forEach((b, i) => {
      const mine = this.seats[i]!.seat === seat;
      clearTimeout(this.bubbleTimers[i]);
      if (!mine) return void (b.hidden = true);
      b.classList.toggle("thought", thought);
      b.replaceChildren(...(thought ? [el("span", { className: "to", textContent: "Thinking" }), text] : to ? [el("span", { className: "to", textContent: `→ ${to}` }), text] : [text]));
      b.hidden = text === "";
      this.bubbleTimers[i] = setTimeout(() => (b.hidden = true), BUBBLE_MS);
    });
  }

  private draw(): void {
    const st = this.state;
    this.info.hidden = !st || (st.pot === undefined && !st.street && !(st.board?.length));
    this.info.replaceChildren();
    if (st && !this.info.hidden) {
      if (st.pot !== undefined) this.info.append(el("span", { className: "pot" }, `Pot: ${money(st.pot)}`, chipIcon()));
      if (st.street) this.info.append(el("span", { className: "street", textContent: st.street }));
      if (this.showCards && st.board?.length) this.info.append(el("ul", { className: "cards", ariaLabel: "Board" }, ...st.board.map(cardEl)));
    }
    this.seats.forEach((s, i) => {
      const plate = this.plates[i]!;
      const row = st?.seats.find((x) => x.seat_id === s.seat);
      plate.classList.toggle("folded", row?.folded === true);
      if (st?.turn === s.seat) plate.setAttribute("aria-current", "true");
      else plate.removeAttribute("aria-current");
      const kids: (Node | string)[] = [];
      if (st?.dealer === s.seat) kids.push(el("span", { className: "badge", textContent: "D", ariaLabel: "Dealer" }));
      kids.push(el("span", { className: "name", textContent: label(s) }));
      if (row) {
        kids.push(el("span", { className: "money" }, row.folded ? "Folded" : `Stack ${money(row.stack)}`));
        if (row.bet) kids.push(el("span", { className: "money" }, `Bet ${money(row.bet)}`));
        if (this.showCards && row.cards?.length) kids.push(el("ul", { className: "cards", ariaLabel: "Cards" }, ...row.cards.map(cardEl)));
      }
      plate.replaceChildren(...kids);
    });
  }
}
