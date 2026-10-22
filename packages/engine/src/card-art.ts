// The two looks of a card (VIK-115): `clean` (the default: a big rank and a big suit, easy to read across a room) and `classic` (`?cards=classic`: a card as in a
// real deck, with index corners, the pips of the rank laid out in their traditional places, a big ace, and framed court cards). Both are drawn here in code, so
// there is no deck artwork to license or load (packages/engine/ASSETS.md says so); `classic` is only drawn when asked for, and only for the cards that are shown.
import { cardFace, SUIT_PATHS, type CardFace } from "./table.ts";

export type Deck = "clean" | "classic";

export function parseDeck(value: string | null | undefined): Deck {
  return value === "classic" ? "classic" : "clean";
}

/** Where the pips of each rank sit, as fractions of the pip field (x from left to right, y from top to bottom): the layout of a standard deck. */
const L = 0.0;
const C = 0.5;
const R = 1.0;
export const PIPS: Record<string, [number, number][]> = {
  "2": [[C, 0], [C, 1]],
  "3": [[C, 0], [C, 0.5], [C, 1]],
  "4": [[L, 0], [R, 0], [L, 1], [R, 1]],
  "5": [[L, 0], [R, 0], [C, 0.5], [L, 1], [R, 1]],
  "6": [[L, 0], [R, 0], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
  "7": [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
  "8": [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [C, 0.75], [L, 1], [R, 1]],
  "9": [[L, 0], [R, 0], [L, 1 / 3], [R, 1 / 3], [C, 0.5], [L, 2 / 3], [R, 2 / 3], [L, 1], [R, 1]],
  "10": [[L, 0], [R, 0], [C, 1 / 6], [L, 1 / 3], [R, 1 / 3], [L, 2 / 3], [R, 2 / 3], [C, 5 / 6], [L, 1], [R, 1]],
  A: [[C, 0.5]],
};

/** The art on a court card's frame: a crown with three points for a king, a lower one with a jewel for a queen, a feathered cap for a jack. */
const COURT_PATHS: Record<string, string> = {
  K: "M10 70 L10 28 L32 48 L50 14 L68 48 L90 28 L90 70 Z M10 78 H90 V90 H10 Z",
  Q: "M10 70 L16 30 L34 52 L50 20 L66 52 L84 30 L90 70 Z M10 78 H90 V90 H10 Z",
  J: "M14 74 C14 40 36 22 62 24 L88 20 C80 30 78 40 82 52 C86 62 84 70 86 74 Z M20 80 H86 V90 H20 Z",
};

const INK = { red: "#c8352f", black: "#1f2430" };

function pip(g: CanvasRenderingContext2D, suit: string, x: number, y: number, size: number, flip = false): void {
  const path = SUIT_PATHS[suit];
  if (!path) return;
  g.save();
  g.translate(x, y);
  if (flip) g.rotate(Math.PI);
  g.scale(size / 100, size / 100);
  g.translate(-50, -50);
  g.fill(new Path2D(path));
  g.restore();
}

/** Draw the face of `card` (not a back) in the classic look onto a canvas of `w` by `h`. */
export function drawClassicFace(g: CanvasRenderingContext2D, f: CardFace, w: number, h: number): void {
  g.fillStyle = "#fdf8ee";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#8a7d6a";
  g.lineWidth = Math.max(2, w * 0.03);
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  g.fillStyle = f.red ? INK.red : INK.black;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const rank = f.rank;
  // Index corners: the rank with a small pip under it, top left, and the same turned round, bottom right.
  const idx = (flip: boolean) => {
    g.save();
    if (flip) {
      g.translate(w, h);
      g.rotate(Math.PI);
    }
    g.font = `bold ${Math.round(w * (rank.length > 1 ? 0.17 : 0.22))}px sans-serif`;
    g.fillText(rank, w * 0.12, h * 0.085);
    pip(g, f.suit, w * 0.12, h * 0.185, w * 0.12);
    g.restore();
  };
  idx(false);
  idx(true);
  const field = { x: w * 0.36, y: h * 0.17, w: w * 0.28, h: h * 0.66 };
  const court = COURT_PATHS[rank];
  if (court) {
    g.strokeStyle = f.red ? INK.red : INK.black;
    g.lineWidth = Math.max(2, w * 0.02);
    g.strokeRect(w * 0.22, h * 0.14, w * 0.56, h * 0.72);
    g.fillStyle = f.red ? "#f6e3dc" : "#e9e6df";
    g.fillRect(w * 0.22, h * 0.14, w * 0.56, h * 0.72);
    g.fillStyle = f.red ? INK.red : INK.black;
    g.save();
    g.translate(w * 0.3, h * 0.2);
    g.scale((w * 0.4) / 100, (w * 0.4) / 100);
    g.fill(new Path2D(court));
    g.restore();
    g.font = `bold ${Math.round(w * 0.3)}px sans-serif`;
    g.fillText(rank, w * 0.5, h * 0.62);
    pip(g, f.suit, w * 0.36, h * 0.78, w * 0.15);
    pip(g, f.suit, w * 0.64, h * 0.78, w * 0.15);
    return;
  }
  const pips = PIPS[rank] ?? [];
  const size = rank === "A" ? w * 0.5 : w * 0.18;
  for (const [px, py] of pips) pip(g, f.suit, field.x + px * field.w, field.y + py * field.h, size, py > 0.5 && rank !== "A");
}

let deck: Deck = "clean";

/** Which look the page's cards have (`?cards=`), set once at start-up before any card is drawn. */
export function setDeck(d: Deck): void {
  deck = d;
}

export function currentDeck(): Deck {
  return deck;
}

const faces = new Map<string, string>();

/** The classic face of `card` as a picture URL, drawn once, for the panel and the page's cards. Needs a document. */
export function classicFaceUrl(card: string): string | undefined {
  const f = cardFace(card);
  if (f.down || !f.suit) return undefined;
  const hit = faces.get(card);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 180;
  drawClassicFace(c.getContext("2d")!, f, 128, 180);
  const url = c.toDataURL("image/png");
  faces.set(card, url);
  return url;
}
