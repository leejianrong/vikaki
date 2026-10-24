// The 3D table view (`?seats=N&view=table`, VIK-62, ADR-0019): seats round an oval felt table. Pure layout here, so it is
// testable without a renderer; the page (table-page.ts) does the three.js work with `buildTable`.
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";

export interface SeatSpot {
  x: number;
  z: number;
  /** Direction the seat faces, radians about y, 0 being toward +z (the camera). It faces the middle of the table. */
  facing: number;
}

/** Half the table's length (along x, the way the camera looks across it) and half its width (along z), in metres, to the edge of the felt. */
export const TABLE_A = 1.45;
export const TABLE_B = 0.82;
/** The wooden rail round the felt. */
export const RAIL = 0.07;
/** How far behind the rail a seat's origin is (the hips). */
export const SEAT_OFFSET = 0.2;

/** Whether (x, z) is on the felt, `margin` metres inside its edge. */
export function onFelt(x: number, z: number, margin = 0.05): boolean {
  return (x / (TABLE_A - margin)) ** 2 + (z / (TABLE_B - margin)) ** 2 < 1;
}

/**
 * Seats round an oval table, each just behind the rail and facing straight in (the perpendicular to the rail where it sits).
 * Up to four seats share the far long side, evenly spread by angle, so three sit left, middle and right with room between them. Five or more
 * go round the whole oval, from the far left clockwise as seen from above: the ones on the near side have their backs to the camera, which
 * the page does not frame well yet (VIK-88).
 */
export function ovalSeats(n: number): SeatSpot[] {
  return Array.from({ length: n }, (_, i) => {
    const phi = n <= 4 ? Math.PI + (Math.PI * (i + 1)) / (n + 1) : Math.PI + ((i + 0.5) * 2 * Math.PI) / n;
    const px = TABLE_A * Math.cos(phi);
    const pz = TABLE_B * Math.sin(phi);
    let nx = Math.cos(phi) / TABLE_A; // outward, perpendicular to the rail
    let nz = Math.sin(phi) / TABLE_B;
    const len = Math.hypot(nx, nz);
    nx /= len;
    nz /= len;
    return { x: px + nx * (RAIL + SEAT_OFFSET), z: pz + nz * (RAIL + SEAT_OFFSET), facing: Math.atan2(-nx, -nz) };
  });
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const MAX_LOOK = 0.6;

/**
 * Head yaw, in radians, to look from one seat at another: how far the direction to the other seat is from the way this one faces,
 * eased and capped like the row's `lookYaw`. Positive turns toward world +x when facing +z. Nobody looks at themselves.
 */
export function seatLookYaw(from: SeatSpot, to: SeatSpot): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  const delta = wrap(Math.atan2(dx, dz) - from.facing);
  return Math.sign(delta) * Math.min(MAX_LOOK, Math.abs(delta) * 0.6);
}

/** Median of the numbers, so one odd avatar does not decide the table's height (ADR-0019). */
export function medianHeight(ys: number[]): number {
  const s = [...ys].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const mat = (color: number, roughness = 0.8) => new MeshStandardMaterial({ color, roughness });

/** The table itself: an oval felt top at `tableY`, a wooden rail, a pedestal, and a floor. Stretched cylinders, a handful of draw calls. */
export function buildTable(tableY: number): Group {
  const g = new Group();
  const top = new Mesh(new CylinderGeometry(TABLE_B, TABLE_B, 0.05, 64), mat(0x2f7a4d, 0.95));
  top.scale.x = TABLE_A / TABLE_B;
  top.position.y = tableY - 0.025;
  const rim = new Mesh(new CylinderGeometry(TABLE_B + RAIL, TABLE_B + RAIL, 0.07, 64), mat(0x7a4a24, 0.6));
  rim.scale.x = (TABLE_A + RAIL) / (TABLE_B + RAIL);
  rim.position.y = tableY - 0.04;
  const pedestal = new Mesh(new CylinderGeometry(0.2, 0.3, tableY, 24), mat(0x4a3018));
  pedestal.scale.x = 2.6;
  pedestal.position.y = tableY / 2 - 0.05;
  const floor = new Mesh(new PlaneGeometry(14, 10), mat(0x8a6244, 1));
  floor.rotation.x = -Math.PI / 2;
  g.add(top, rim, pedestal, floor);
  return g;
}
