// The 3D table view (`?seats=N&view=table`, VIK-62, ADR-0019): seats on a half circle round a felt table. Pure layout here, so it is
// testable without a renderer; the page (table-page.ts) does the three.js work with `buildTable`.
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";

export interface SeatSpot {
  x: number;
  z: number;
  /** Direction the seat faces, radians about y, 0 being toward +z (the camera). It faces the middle of the table. */
  facing: number;
}

/** Seats on the far half of a circle of `radius` round the origin, evenly spread, the middle one straight ahead of the camera for odd counts. */
export function circleSeats(n: number, radius = 0.95): SeatSpot[] {
  const step = Math.min(0.95, 2.6 / Math.max(1, n - 1)); // three seats are 0.95 rad apart; more are packed into the same arc
  return Array.from({ length: n }, (_, i) => {
    const a = (i - (n - 1) / 2) * step;
    const x = radius * Math.sin(a);
    const z = -radius * Math.cos(a);
    return { x, z, facing: Math.atan2(-x, -z) };
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

export const TABLE_RADIUS = 0.78;

const mat = (color: number, roughness = 0.8) => new MeshStandardMaterial({ color, roughness });

/** The table itself: felt top at `tableY`, a wooden rim, a pedestal, and a floor. Plain meshes, a handful of draw calls. */
export function buildTable(tableY: number): Group {
  const g = new Group();
  const top = new Mesh(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.05, 64), mat(0x2f7a4d, 0.95));
  top.position.y = tableY - 0.025;
  const rim = new Mesh(new CylinderGeometry(TABLE_RADIUS + 0.06, TABLE_RADIUS + 0.06, 0.07, 64), mat(0x7a4a24, 0.6));
  rim.position.y = tableY - 0.04;
  const pedestal = new Mesh(new CylinderGeometry(0.18, 0.3, tableY, 24), mat(0x4a3018));
  pedestal.position.y = tableY / 2 - 0.05;
  const floor = new Mesh(new PlaneGeometry(8, 8), mat(0x1c232b, 1));
  floor.rotation.x = -Math.PI / 2;
  g.add(top, rim, pedestal, floor);
  return g;
}
