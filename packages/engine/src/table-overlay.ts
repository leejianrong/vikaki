// The table page's overlay (VIK-59): pot, board and street at the top, a plate under each avatar (name, stack, bet, cards, dealer button,
// turn marker), and a transcript strip. It draws the last `table_state` and the lines it is told of, and holds no game logic: what the
// plates say is what the game sent. Plain DOM with roles and names, so tests find things the way a person would.
import type { MessageOf } from "@vikaki/protocol";
import { addToTranscript, cardFace, type Seat, type TranscriptLine } from "./table.ts";
import { el } from "./ui/dom.ts";
import "./ui/material.ts";
import "./ui/table.css";

type State = MessageOf<"table_state">;

const label = (s: Seat) => s.persona ?? s.seat;
const money = (n: number) => n.toLocaleString("en-US");

function cardEl(card: string): HTMLElement {
  const f = cardFace(card);
  return el("li", { className: `card${f.red ? " red" : ""}${f.down ? " down" : ""}`, textContent: f.text, ariaLabel: f.down ? "face-down card" : f.text });
}

export class TableOverlay {
  private readonly root = el("div", { className: "table-overlay" });
  private readonly info = el("section", { className: "table-info", ariaLabel: "Table", hidden: true });
  private readonly plates: HTMLElement[];
  private readonly log = el("div", { className: "transcript", role: "log", ariaLabel: "Transcript" });
  private lines: TranscriptLine[] = [];
  private state: State | undefined;

  constructor(private readonly seats: Seat[], parent: HTMLElement = document.body) {
    this.plates = seats.map((s) => el("div", { className: "seat-plate", role: "group", ariaLabel: label(s) }));
    this.root.append(this.info, ...this.plates, this.log);
    parent.append(this.root);
    this.draw();
  }

  /** Put each seat's plate under its avatar: `xs` are the avatars' centres in pixels from the left edge. */
  place(xs: number[]): void {
    this.plates.forEach((p, i) => {
      if (xs[i] !== undefined) p.style.left = `${Math.round(xs[i]!)}px`;
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
  }

  private draw(): void {
    const st = this.state;
    this.info.hidden = !st || (st.pot === undefined && !st.street && !(st.board?.length));
    this.info.replaceChildren();
    if (st && !this.info.hidden) {
      if (st.pot !== undefined) this.info.append(el("span", { className: "pot" }, `Pot ${money(st.pot)}`));
      if (st.street) this.info.append(el("span", { className: "street", textContent: st.street }));
      if (st.board?.length) this.info.append(el("ul", { className: "cards", ariaLabel: "Board" }, ...st.board.map(cardEl)));
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
        if (row.cards?.length) kids.push(el("ul", { className: "cards", ariaLabel: "Cards" }, ...row.cards.map(cardEl)));
      }
      plate.replaceChildren(...kids);
    });
  }
}
