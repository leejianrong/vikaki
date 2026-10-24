// Peeking at the cards (VIK-104): the player lifts the near edge of the two face-down cards to look at them, the head dips, and the cards settle back.
// The curve and the geometry are pure, so they are tested without a renderer; `TableProps.setPeek` places the cards and the page moves the head.

/** The most the cards tilt, radians (the near edge lifted toward the player, the face turned away from the room), and the head's dip. */
export const PEEK_TILT = 0.9;
export const PEEK_HEAD = 0.28;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** How far through a peek of `phase` (0 to 1) the cards and the head are, each from 0 to 1: the head dips first, the cards come up, hold, and go down before the head lifts. */
export function peekPhase(phase: number): { cards: number; head: number } {
  return {
    head: smooth(phase / 0.2) * (1 - smooth((phase - 0.8) / 0.2)),
    cards: smooth((phase - 0.1) / 0.2) * (1 - smooth((phase - 0.7) / 0.2)),
  };
}

/**
 * Where a card of height `h` lying flat goes when its near edge (the one toward the player) is lifted by `amount` (0 to 1): turned by `alpha` about that
 * edge, so the middle moves `up` and `toward` the player (negative along the way the seat faces).
 */
export function peekPlacement(amount: number, h: number): { alpha: number; up: number; along: number } {
  const alpha = amount * PEEK_TILT;
  return { alpha, up: (h / 2) * Math.sin(alpha), along: (h / 2) * (Math.cos(alpha) - 1) };
}
