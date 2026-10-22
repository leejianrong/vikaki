// The POV grid (VIK-100): every player's point of view on one picture, a tile each. Pure layout and pacing; the page does the drawing.

export interface Tile {
  /** In CSS pixels from the top left of the canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How many columns make the tiles closest to this shape (16:9 is about right for a view of a room). */
const IDEAL_ASPECT = 1.6;

/** `n` tiles in a `width` by `height` area with `gap` between them: the number of columns that makes the tiles most like the ideal shape, and the last row centred. */
export function gridLayout(n: number, width: number, height: number, gap = 6): Tile[] {
  if (n <= 0) return [];
  let best = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (width - gap * (cols - 1)) / cols / ((height - gap * (rows - 1)) / rows);
    const score = Math.abs(Math.log(aspect / IDEAL_ASPECT));
    if (score < best.score) best = { cols, score };
  }
  const { cols } = best;
  const rows = Math.ceil(n / cols);
  const w = (width - gap * (cols - 1)) / cols;
  const h = (height - gap * (rows - 1)) / rows;
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const offset = ((cols - inRow) * (w + gap)) / 2; // a short last row sits in the middle
    tiles.push({ x: Math.round(offset + (i % cols) * (w + gap)), y: Math.round(row * (h + gap)), width: Math.round(w), height: Math.round(h) });
  }
  return tiles;
}

/**
 * Draw the grid every this many frames: drawing the room once for each player costs that many times a single shot, which a software renderer cannot do at
 * 60 frames a second. `frameMs` is how long the last frame took; a quick one draws every second frame, a slow one a few times a second, and the tiles hold
 * their last picture in between.
 */
export function gridInterval(frameMs: number): number {
  if (frameMs <= 20) return 2;
  return Math.min(12, Math.max(2, Math.ceil(frameMs / 8)));
}
