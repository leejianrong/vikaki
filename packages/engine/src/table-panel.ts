// The spectator panel beside the 3D table (VIK-83): the pot, the street and the board, then one card per seat with its two hole cards, the hand
// in words, its chance to win as a bar, its stack, its bet and what it did last. Like the overlay it draws only what `table_state` carries and
// knows no poker: the words and the odds are the game's, sent when the table may see the cards. Plain DOM with roles and names for tests.
import type { MessageOf } from "@vikaki/protocol";
import { makeResizable } from "./panel-resize.ts";
import { cardEl } from "./table-overlay.ts";
import { addToTranscript, CHAT_LINES, favourite, lineLabel, percent, seatColour, type Seat, type TranscriptLine } from "./table.ts";
import { el } from "./ui/dom.ts";
import "./ui/material.ts";
import "./ui/table.css";

type State = MessageOf<"table_state">;

const label = (s: Seat) => s.persona ?? s.seat;
const money = (n: number) => n.toLocaleString("en-US");

export class TablePanel {
  private readonly root = el("aside", { className: "side-sheet table-panel", ariaLabel: "Table panel" });
  private readonly head = el("section", { className: "panel-head", ariaLabel: "Pot and board" });
  private readonly cards: HTMLElement[];
  private readonly chat = el("div", { className: "chat", role: "log", ariaLabel: "Chat", tabIndex: 0 });
  private lines: TranscriptLine[] = [];
  private readonly thoughts = el("div", { className: "chat thoughts", role: "log", ariaLabel: "Thoughts", tabIndex: 0 });
  private thoughtLines: { seat: string; text: string }[] = [];

  constructor(private readonly seats: Seat[], parent: HTMLElement = document.body) {
    this.cards = seats.map((s) => el("section", { className: "seat-card", role: "group", ariaLabel: `${label(s)}, hand` }));
    // The pot, board and hands on the left, what is said and thought on the right: side by side when the panel is dragged wide (VIK-111).
    const left = el("div", { className: "panel-left" }, el("h1", { className: "title-large", textContent: "Table" }), this.head, ...this.cards);
    const right = el("div", { className: "panel-right" }, el("h2", { className: "title-medium", textContent: "Chat" }), this.chat, el("h2", { className: "title-medium", textContent: "Thoughts" }), this.thoughts);
    this.root.append(left, right);
    document.body.classList.add("has-panel", "has-table-panel");
    parent.append(this.root);
    makeResizable((wide) => this.root.classList.toggle("wide", wide));
    this.draw();
  }

  setState(state: State): void {
    this.draw(state);
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
  }

  private draw(st?: State): void {
    const head: (Node | string)[] = [];
    head.push(el("span", { className: "pot", textContent: `Pot ${money(st?.pot ?? 0)}` }));
    if (st?.street) head.push(el("span", { className: "street", textContent: st.street }));
    this.head.replaceChildren(...head);
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
      card.replaceChildren(...kids);
    });
  }
}
