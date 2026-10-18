// The table page's overlay (VIK-59): pot, board and street at the top, a plate under each avatar (name, stack, bet, cards, dealer button,
// turn marker), and a transcript strip. It draws the last `table_state` and the lines it is told of, and holds no game logic: what the
// plates say is what the game sent. Plain DOM with roles and names, so tests find things the way a person would.
import type { MessageOf } from "@vikaki/protocol";
import type { EmbedOptions } from "./embed.ts";
import { addToTranscript, cardFace, seatColour, type Seat, type TranscriptLine } from "./table.ts";
import { el } from "./ui/dom.ts";
import "./ui/material.ts";
import "./ui/table.css";

type State = MessageOf<"table_state">;

const label = (s: Seat) => s.persona ?? s.seat;
const money = (n: number) => n.toLocaleString("en-US");

/** How long a speech bubble stays after its line's last piece (ms). */
export const BUBBLE_MS = 4000;

export function cardEl(card: string): HTMLElement {
  const f = cardFace(card);
  return el("li", { className: `card${f.red ? " red" : ""}${f.down ? " down" : ""}`, textContent: f.text, ariaLabel: f.down ? "face-down card" : f.text });
}

export class TableOverlay {
  private readonly root = el("div", { className: "table-overlay" });
  private readonly info = el("section", { className: "table-info", ariaLabel: "Table", hidden: true });
  private readonly plates: HTMLElement[];
  private readonly log = el("div", { className: "transcript", role: "log", ariaLabel: "Transcript" });
  private readonly bubbles: HTMLElement[];
  private readonly bubbleTimers: (ReturnType<typeof setTimeout> | undefined)[];
  private lines: TranscriptLine[] = [];
  private state: State | undefined;
  /** False when the cards are drawn on a 3D table: a plate then says only name, stack and bet. */
  showCards = true;

  /** In embed mode (VIK-64) the pot strip is never drawn, and the plates and transcript only when asked for. */
  /** With the spectator panel beside the table (VIK-83) the pot, street and board are in the panel, so the strip at the top is not drawn twice. */
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
    this.bubbles = seats.map((s, i) => {
      const b = el("p", { className: "bubble", hidden: true, ariaLabel: `${label(s)} says` });
      b.style.setProperty("--seat-colour", seatColour(i));
      return b;
    });
    this.bubbleTimers = seats.map(() => undefined);
    this.root.append(this.info, ...this.plates, ...this.bubbles, this.log);
    parent.append(this.root);
    this.draw();
  }

  /** Put each seat's plate under its avatar: `xs` are the avatars' centres in pixels from the left edge. `tops`, when known, are the pixels from the top edge of the heads: a bubble sits just above. */
  place(xs: number[], tops?: number[]): void {
    this.plates.forEach((p, i) => {
      if (xs[i] !== undefined) p.style.left = `${Math.round(xs[i]!)}px`;
    });
    this.bubbles.forEach((b, i) => {
      if (xs[i] !== undefined) b.style.left = `${Math.round(xs[i]!)}px`;
      if (tops?.[i] !== undefined) b.style.top = `${Math.round(tops[i]!)}px`;
    });
  }

  setState(state: State): void {
    this.state = state;
    this.draw();
  }

  addText(line: { id: string; seat: string; text?: string; delta?: string }): void {
    this.lines = addToTranscript(this.lines, line);
    const name = (seat: string) => {
      const s = this.seats.find((x) => x.seat === seat);
      return s ? label(s) : seat;
    };
    this.log.replaceChildren(...this.lines.map((l) => el("p", {}, el("b", { textContent: name(l.seat) }), l.text)));
    this.showBubble(line.seat, this.lines.find((l) => l.id === line.id)?.text ?? "");
  }

  /** The speaker's bubble shows the line as far as it has arrived and fades some seconds after the last piece; no other seat keeps one. */
  private showBubble(seat: string, text: string): void {
    this.bubbles.forEach((b, i) => {
      const mine = this.seats[i]!.seat === seat;
      clearTimeout(this.bubbleTimers[i]);
      if (!mine) return void (b.hidden = true);
      b.textContent = text;
      b.hidden = text === "";
      this.bubbleTimers[i] = setTimeout(() => (b.hidden = true), BUBBLE_MS);
    });
  }

  private draw(): void {
    const st = this.state;
    this.info.hidden = !st || (st.pot === undefined && !st.street && !(st.board?.length));
    this.info.replaceChildren();
    if (st && !this.info.hidden) {
      if (st.pot !== undefined) this.info.append(el("span", { className: "pot" }, `Pot ${money(st.pot)}`));
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
