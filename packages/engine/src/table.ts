import { frameFromEyeLevel, type Framing } from "./framing.ts";

/** One place at the table: the seat id a driver names, and the persona (so the avatar and voice) that seat uses. */
export interface Seat {
  seat: string;
  persona?: string;
}

/** Most seats on one page. Past this the avatars are too small to read, and a page per seat is the better tool. */
export const MAX_SEATS = 8;

/**
 * The seats a `?seats=` value asks for.
 *
 * - `3`: three seats, `seat-1` to `seat-3`, taking the hub's personas in order (reused in turn if there are fewer than seats).
 * - `ada,ben`: bare names are personas for `seat-1`, `seat-2`, ...
 * - `north:ada,south:ben`: seat ids named, each with its persona.
 *
 * `known` is the hub's persona names. A persona it lacks is an error that says which ones it has.
 */
export function parseSeats(value: string, known: string[]): Seat[] {
  const text = value.trim();
  let seats: Seat[];
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n < 1 || n > MAX_SEATS) throw new Error(`seats must be between 1 and ${MAX_SEATS}, got ${n}`);
    seats = Array.from({ length: n }, (_, i) => ({ seat: `seat-${i + 1}`, ...(known.length ? { persona: known[i % known.length]! } : {}) }));
  } else {
    const parts = text.split(",").map((p) => p.trim());
    if (text === "" || parts.some((p) => p === "")) throw new Error("seats is a number, or a comma-separated list such as ada,ben or north:ada,south:ben");
    if (parts.length > MAX_SEATS) throw new Error(`seats must be between 1 and ${MAX_SEATS}, got ${parts.length}`);
    seats = parts.map((p, i) => {
      const [a, b] = p.split(":");
      if (!/^\w[\w.-]*(:\w[\w.-]*)?$/.test(p)) throw new Error(`cannot read seat "${p}": use ada or north:ada`);
      return b === undefined ? { seat: `seat-${i + 1}`, persona: a! } : { seat: a!, persona: b };
    });
  }
  const seen = new Set<string>();
  for (const s of seats) {
    if (seen.has(s.seat)) throw new Error(`seat ${s.seat} is listed twice`);
    seen.add(s.seat);
    if (s.persona !== undefined && known.length > 0 && !known.includes(s.persona)) {
      throw new Error(`no persona "${s.persona}" on this hub (known: ${known.join(", ")})`);
    }
  }
  return seats;
}

/** Which seat plays a line (or shows a turn): the one its seat id names, else the one with its persona. Undefined if none. */
export function seatFor(seats: Seat[], line: { seat?: string; persona?: string } | undefined): number | undefined {
  if (!line) return undefined;
  if (line.seat !== undefined) {
    const bySeat = seats.findIndex((s) => s.seat === line.seat);
    if (bySeat >= 0) return bySeat;
  }
  if (line.persona !== undefined) {
    const byPersona = seats.findIndex((s) => s.persona === line.persona);
    if (byPersona >= 0) return byPersona;
  }
  return undefined;
}

/** x position of each avatar's centre in a row centred on zero, given each one's width and the gap between neighbours. */
export function layoutRow(widths: number[], gap: number): number[] {
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
  const xs: number[] = [];
  let left = -total / 2;
  for (const w of widths) {
    xs.push(left + w / 2);
    left += w + gap;
  }
  return xs;
}

/**
 * Frame a row of avatars from the eye line: tall enough for the heads (as `frameFromEyeLevel`) and far enough back that the whole
 * row's `spanWidth` fits the canvas's `aspect` (width over height), whichever needs the camera further away.
 */
export function frameRow(o: { eyeY: number; headY: number; topY: number; fov: number; spanWidth: number; aspect: number; margin?: number }): Framing {
  const tall = frameFromEyeLevel(o.eyeY, o.headY, o.topY, o.fov, o.margin);
  const wideDistance = (o.spanWidth / 2) * 1.08 / (Math.tan((o.fov * Math.PI) / 360) * Math.max(o.aspect, 0.1));
  return { y: tall.y, distance: Math.max(tall.distance, wideDistance) };
}

/** A card as the page draws it. `back` is a card face down; a name it cannot read is shown as sent, so a game with its own deck still works. */
export interface CardFace {
  text: string;
  /** The rank as shown ("A", "10") and the suit letter ("s", "h", "d", "c"), for drawing the pip as a shape (VIK-141); both empty for a card face down. */
  rank: string;
  suit: string;
  red: boolean;
  down: boolean;
}

const SUITS: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

/**
 * The four suits drawn as shapes in a 100 by 100 box (VIK-141), because the font's black spade and club are about the same size and weight and were
 * mixed up at a glance: the spade is a pointed leaf on a narrow stem, the club three round lobes that do not touch. Used as an SVG path in the
 * panel and as a `Path2D` on the cards on the table, so both show the same shapes.
 */
export const SUIT_PATHS: Record<string, string> = {
  s: "M50 4C47 20 6 40 6 64c0 17 15 25 28 25 6 0 10-2 13-6-1 9-4 15-10 19h26c-6-4-9-10-10-19 3 4 7 6 13 6 13 0 28-8 28-25C94 40 53 20 50 4z",
  c: "M27 27a23 23 0 1 0 46 0a23 23 0 1 0-46 0zM2 63a23 23 0 1 0 46 0a23 23 0 1 0-46 0zM52 63a23 23 0 1 0 46 0a23 23 0 1 0-46 0zM50 50c0 28-3 40-14 46h28c-11-6-14-18-14-46z",
  h: "M50 94C20 70 4 52 4 33 4 17 16 6 30 6c9 0 16 5 20 13C54 11 61 6 70 6c14 0 26 11 26 27 0 19-16 37-46 61z",
  d: "M50 3 88 50 50 97 12 50z",
};

/** `As` is A♠, `Td` is 10♦, `back` is face down. Only formatting: the page knows no rules. */
export function cardFace(card: string): CardFace {
  if (card === "back") return { text: "", rank: "", suit: "", red: false, down: true };
  const suit = SUITS[card.slice(-1).toLowerCase()];
  const rank = card.slice(0, -1);
  if (!suit || rank === "") return { text: card, rank: card, suit: "", red: false, down: false };
  const s = card.slice(-1).toLowerCase();
  const shown = rank.toUpperCase() === "T" ? "10" : rank.toUpperCase();
  return { text: `${shown}${suit}`, rank: shown, suit: s, red: s === "h" || s === "d", down: false };
}

/** One line of the transcript: who said it (a seat id), and what, as far as it has arrived. */
export interface TranscriptLine {
  id: string;
  seat: string;
  text: string;
  /** The seat the line was for (VIK-120); absent for a line to the whole table. */
  to?: string;
}

/** Who said a line, and to whom when it was for one player: "ada → ben". `name` turns a seat id into what the page calls it. */
export function lineLabel(line: { seat: string; to?: string }, name: (seat: string) => string): string {
  return line.to ? `${name(line.seat)} → ${name(line.to)}` : name(line.seat);
}

/** Lines kept in the transcript strip. */
export const TRANSCRIPT_LINES = 3;

/** Lines kept in the panel's chat, which scrolls. */
export const CHAT_LINES = 80;

/** The Material colour role that names a seat's lines in the chat and its bubble: neighbours differ, and any number of seats get one. */
export function seatColour(i: number): string {
  return `var(--md-sys-color-${["primary", "tertiary", "secondary", "error"][i % 4]})`;
}

/**
 * Add what an `utterance` message carries to the transcript: a whole `text` makes a line, `delta` pieces grow the line of the same id.
 * Returns the last `max` lines; the list it was given is not changed.
 */
export function addToTranscript(lines: TranscriptLine[], m: { id: string; seat: string; text?: string; delta?: string; to?: string }, max = TRANSCRIPT_LINES): TranscriptLine[] {
  const piece = m.text ?? m.delta ?? "";
  const at = lines.findIndex((l) => l.id === m.id);
  const next =
    at < 0
      ? [...lines, { id: m.id, seat: m.seat, text: piece, ...(m.to ? { to: m.to } : {}) }]
      : lines.map((l, i) => (i === at ? { ...l, text: m.text !== undefined ? piece : l.text + piece, ...(m.to ? { to: m.to } : {}) } : l));
  return next.slice(-max);
}

/** The most a head turns to look at a neighbour (radians, about 25 degrees): a glance, not a face turned away from the camera. */
export const MAX_LOOK = 0.45;

/**
 * The head yaw that looks from a seat at `fromX` to a speaker at `toX` (metres across the table). Positive turns toward larger x, which
 * is the right of the screen. It grows with the gap and tops out at `MAX_LOOK`, so a neighbour gets a small turn and the far end of
 * a wide table the full one. Nobody looks at themselves.
 */
export function lookYaw(fromX: number, toX: number): number {
  const dx = toX - fromX;
  if (Math.abs(dx) < 1e-6) return 0;
  return Math.sign(dx) * Math.min(MAX_LOOK, Math.atan2(Math.abs(dx), 3));
}

/** A chance to win from 0 to 1 as the panel says it: whole percent, never a rounded-up 100 or a rounded-down 0 for a hand that can still go either way. */
export function percent(win: number): string {
  const p = Math.round(win * 100);
  if (win > 0 && p === 0) return "<1%";
  if (win < 1 && p === 100) return ">99%";
  return `${p}%`;
}

/** The seat the panel marks as the favourite: the one with the highest chance to win, or undefined with no chances sent or a tie for the lead. */
export function favourite(seats: { seat_id: string; win?: number }[]): string | undefined {
  const withWin = seats.filter((s): s is { seat_id: string; win: number } => s.win !== undefined);
  if (withWin.length < 2) return undefined;
  const top = Math.max(...withWin.map((s) => s.win));
  const leaders = withWin.filter((s) => s.win === top);
  return leaders.length === 1 ? leaders[0]!.seat_id : undefined;
}
