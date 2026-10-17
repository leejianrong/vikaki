// The duet layout (`?layout=duet`, VIK-68): two avatars angled toward each other with a clear band between them, for a two-player game that
// draws its own board there (Wavelength's half-circle dial). Pure geometry, so the promise "nothing is drawn in the band" is a test, not a hope.
/** The band the game draws over, in CSS pixels: wide enough for a 440 px dial. On a phone it is the full width instead. */
export const DUET_BAND = 440;
/** Breathing room kept clear at each side of the band, and between an avatar and the band. */
export const DUET_PAD = 16;
/** Narrowest a column beside the band may be before the avatars go above it instead. */
export const DUET_MIN_COLUMN = 150;
/** The share of the canvas height (or of the space above the band) the slice of the avatars fills. */
const FILL = 0.88;
/** How far down its region the top of the avatars sits, as a share of the region: a little headroom, and any extra height shows more body, not more sky. */
const HEADROOM = 0.06;
/** How far each avatar's body turns toward the other (radians, about 29 degrees). */
export const DUET_TURN = 0.5;
/** How far a head glances toward the speaker on top of the body's turn: the body does most of it. */
export const DUET_GLANCE = 0.2;

/** A rectangle on the canvas in CSS pixels. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DuetFrame {
  /** True on a narrow canvas: the avatars sit side by side above the band, which spans the width below them. */
  stacked: boolean;
  /** Camera height and distance (it looks straight ahead). */
  y: number;
  distance: number;
  /** Each avatar's world x: the left one at `-x`, the right one at `x`. */
  x: number;
  /** Where the host draws: nothing of the avatars is inside it. */
  band: Rect;
}

export interface DuetInput {
  /** The canvas in CSS pixels. */
  width: number;
  height: number;
  fov: number;
  /** The slice of the avatars to keep in view, in world height: the top of the tallest and where the bust ends. */
  top: number;
  bottom: number;
  /** The lowest point of the avatars (their feet). When the whole body fits, it stands on the bottom edge of the area for the avatars. */
  floor: number;
  /** The widest avatar's width in metres between two world heights, as turned toward each other (`VrmAvatar.widthProfile`, the larger of the two). */
  widthIn(lo: number, hi: number): number;
}

export function duetFrame(o: DuetInput): DuetFrame {
  const slice = o.top - o.bottom;
  const k = 2 * Math.tan((o.fov * Math.PI) / 360); // visible height per metre of distance
  const perPixel = (distance: number) => (k * distance) / o.height; // metres at the avatars' depth per canvas pixel
  const bandWidth = DUET_BAND + 2 * DUET_PAD;
  const column = (o.width - bandWidth) / 2;
  const stacked = column < DUET_MIN_COLUMN;
  const heightFit = slice / (FILL * k);
  /** Camera height that puts the top of the avatars `HEADROOM` of the way down a region of `region` pixels at the top of the canvas. */
  const yAt = (distance: number, region: number) => o.top - (o.height / 2 - HEADROOM * region) * perPixel(distance);
  /** The final camera height: the headroom one, unless that leaves the feet in view above the region's bottom edge, then lower the avatars to stand on it. */
  const settle = (distance: number, region: number) => {
    const y = yAt(distance, region);
    const feetRow = o.height / 2 - (o.floor - y) / perPixel(distance);
    return feetRow < region ? o.floor - (o.height / 2 - region) * perPixel(distance) : y;
  };

  if (!stacked) {
    // Each avatar takes the column beside the band, as big as the height allows or the column's width allows. What is in view depends on the
    // distance (further back shows more of the body, which is wider), so the width is measured over what the camera will see, until it settles.
    const room = column - 2 * DUET_PAD;
    let distance = heightFit;
    for (let i = 0; i < 8; i++) {
      const y = yAt(distance, o.height);
      const up = perPixel(distance);
      const next = Math.max(heightFit, (o.widthIn(y - (o.height / 2) * up, y + (o.height / 2) * up) * o.height) / (k * room));
      const done = Math.abs(next - distance) < 0.004 * distance;
      distance = next;
      if (done) break;
    }
    const y = yAt(distance, o.height);
    const avatarPixels = o.widthIn(y - (o.height / 2) * perPixel(distance), y + (o.height / 2) * perPixel(distance)) / perPixel(distance);
    const fromCentre = DUET_BAND / 2 + DUET_PAD + avatarPixels / 2;
    return { stacked, y: settle(distance, o.height), distance, x: fromCentre * perPixel(distance), band: { left: (o.width - DUET_BAND) / 2, top: 0, width: DUET_BAND, height: o.height } };
  }

  // Narrow: the band is the full width and as tall as a half-circle dial (half the width), never more than 60% of the canvas. The avatars are
  // cut off at the band's top edge (the page clips there), so only what is above it counts.
  const bandHeight = Math.min(o.width / 2 + 2 * DUET_PAD, 0.6 * o.height);
  const region = o.height - bandHeight;
  const half = Math.max(o.width / 2 - 2 * DUET_PAD, 1);
  let distance = heightFit * (o.height / region);
  for (let i = 0; i < 8; i++) {
    const up = perPixel(distance);
    const y = yAt(distance, region);
    const next = Math.max(heightFit * (o.height / region), (o.widthIn(y - (o.height / 2 - bandHeight) * up, y + (o.height / 2) * up) * o.height) / (k * half));
    const done = Math.abs(next - distance) < 0.004 * distance;
    distance = next;
    if (done) break;
  }
  const up = perPixel(distance);
  return { stacked, y: settle(distance, region), distance, x: (o.width / 4) * up, band: { left: 0, top: region, width: o.width, height: bandHeight } };
}

/** Screen extent in pixels (left, right) of an avatar of `avatarWidth` metres centred at world `x`, seen from `distance` on a canvas this size. */
export function avatarSpan(f: DuetFrame, side: -1 | 1, o: { width: number; height: number; fov: number }, avatarWidth: number): [number, number] {
  const perPixel = (2 * Math.tan((o.fov * Math.PI) / 360) * f.distance) / o.height;
  const centre = o.width / 2 + (side * f.x) / perPixel;
  const half = avatarWidth / perPixel / 2;
  return [centre - half, centre + half];
}
