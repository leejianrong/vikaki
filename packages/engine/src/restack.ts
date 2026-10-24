// Restacking the chips (VIK-105): the player fiddles with a stack, taking the top chip off its column and setting it on the next, then back, and
// riffling the top two. It changes only how the chips are drawn for a moment (the stack is as it was), so it is a pure function of the laid-out chips and
// the phase of the fidget, tested without a renderer. A seat whose arms cannot reach gets this alone, with the head dipping to the chips.
import type { ChipSpot } from "./table-props.ts";

const CHIP_H = 0.016;

/** How far through a restack (0 to 1) the hand is: it reaches in over the first fifth, works, and goes back over the last fifth. */
export function restackReach(phase: number): number {
  const smooth = (x: number) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };
  return smooth(phase / 0.2) * (1 - smooth((phase - 0.8) / 0.2));
}

/**
 * `spots` as drawn at `phase` of a restack. The tallest column's top chip lifts, crosses to sit on the neighbouring column and comes back; the chip under it
 * follows a little behind. A stack of one column has its top chips slid aside along `across` and back. Chips that do not move are the same objects.
 */
export function restackSpots(spots: ChipSpot[], phase: number, across: { x: number; z: number }): ChipSpot[] {
  if (phase <= 0 || phase >= 1 || spots.length === 0) return spots;
  const columns = new Map<number, ChipSpot[]>();
  for (const s of spots) columns.set(s.kind, [...(columns.get(s.kind) ?? []), s]);
  const order = [...columns.values()];
  let at = 0;
  order.forEach((c, i) => {
    if (c.length > order[at]!.length) at = i;
  });
  const col = order[at]!;
  const top = col[col.length - 1]!;
  const under = col.length > 1 ? col[col.length - 2] : undefined;
  const next = order[at + 1] ?? order[at - 1];
  const k = Math.sin(Math.PI * phase);
  const follow = Math.sin(Math.PI * Math.min(1, Math.max(0, phase - 0.12) / 0.88));
  const move = new Map<ChipSpot, ChipSpot>();
  if (next) {
    const dest = { x: next[0]!.x, z: next[0]!.z, y: next[next.length - 1]!.y + CHIP_H };
    move.set(top, { kind: top.kind, x: top.x + (dest.x - top.x) * k, z: top.z + (dest.z - top.z) * k, y: top.y + (dest.y - top.y) * k + 0.03 * k });
  } else {
    move.set(top, { kind: top.kind, x: top.x + across.x * 0.05 * k, z: top.z + across.z * 0.05 * k, y: top.y + 0.012 * k });
  }
  if (under) move.set(under, { kind: under.kind, x: under.x + across.x * 0.02 * follow, z: under.z + across.z * 0.02 * follow, y: under.y + 0.004 * follow });
  return spots.map((s) => move.get(s) ?? s);
}
