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
