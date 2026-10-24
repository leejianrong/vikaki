// The den (VIK-101): a living room in someone's house round the poker table, drawn from a few cartoon shapes in a warm palette. Everything that never
// moves is merged into one mesh with colours on its vertices, so the whole room costs one draw call (and the pendant lamp, which hides for the
// overhead shot, another). No shadow maps: the pool of light under the lamp is a soft additive disc on the felt. Pure geometry with no renderer,
// so it is tested without a browser. Nothing here is imported or sampled: every prop is built from boxes, cylinders and spheres.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Euler,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TABLE_A, TABLE_B } from "./table3d.ts";

/** A thing in the room a seat may glance at (VIK-102): a name for tests and the picture, and where it is in the world. */
export interface LookTarget {
  name: string;
  position: { x: number; y: number; z: number };
}

export interface Den {
  group: Group;
  /** The lamp over the table. Hidden for the overhead shot, whose camera sits right above it. */
  setPendantVisible(visible: boolean): void;
  lookTargets: LookTarget[];
  /** Triangles in the room, for the budget (docs/testing.md). */
  triangles: number;
}

/** The room's walls: the back wall is behind the far seats, the others are further out and face in, so a camera outside a wall sees through it. */
export const ROOM = { back: -2.4, front: 4.8, side: 5, height: 3.2 } as const;

const WARM = {
  wall: 0xe9c9a3,
  wainscot: 0xa9714a,
  trim: 0x6b4423,
  floor: 0x8a6244,
  rugOuter: 0xb5483f,
  rugRing: 0xe8c88a,
  rugInner: 0x9c3b34,
  glass: 0xa6dcf2,
  curtain: 0xd4574f,
  wood: 0x7b4a2a,
  leaf: 0x4f9d5a,
  leafLight: 0x74bf6c,
  pot: 0xc9703f,
  lamp: 0xf2b84b,
  bulb: 0xfff3c0,
  sofa: 0x4f7f8f,
  sofaDark: 0x3d6573,
  clock: 0xfff6e2,
} as const;
const BOOKS = [0xd4574f, 0x4f7f8f, 0xf2b84b, 0x6aa86a, 0x8e6bb0, 0xe98c5c];

type Part = { geometry: BufferGeometry; color: number };

/** A geometry moved, turned and coloured: positions and normals baked, a colour on every vertex, nothing else, so any two can merge. */
function bake(geometry: BufferGeometry, color: number, at: [number, number, number], turn: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): BufferGeometry {
  const g = geometry;
  g.deleteAttribute("uv");
  g.applyMatrix4(new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(new Euler(...turn)), new Vector3(...scale)));
  const c = new Float32Array(g.attributes.position!.count * 3);
  const r = ((color >> 16) & 255) / 255;
  const gr = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  for (let i = 0; i < c.length; i += 3) (c[i] = r), (c[i + 1] = gr), (c[i + 2] = b);
  g.setAttribute("color", new Float32BufferAttribute(c, 3));
  return g;
}

const box = (w: number, h: number, d: number, color: number, at: [number, number, number], turn?: [number, number, number]): Part => ({ geometry: bake(new BoxGeometry(w, h, d), color, at, turn), color });
const cyl = (rt: number, rb: number, h: number, color: number, at: [number, number, number], seg = 12, turn?: [number, number, number], scale?: [number, number, number]): Part => ({ geometry: bake(new CylinderGeometry(rt, rb, h, seg), color, at, turn, scale), color });
const ball = (r: number, color: number, at: [number, number, number], scale?: [number, number, number]): Part => ({ geometry: bake(new SphereGeometry(r, 10, 8), color, at, undefined, scale), color });
const wall = (w: number, h: number, color: number, at: [number, number, number], yaw: number): Part => ({ geometry: bake(new PlaneGeometry(w, h), color, at, [0, yaw, 0]), color });

export function merged(parts: Part[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => p.geometry), false);
  if (!g) throw new Error("the den's parts do not merge");
  return g;
}

/** A radial glow drawn once on a canvas: the lamp's pool of light on the felt. */
function glowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,226,160,1)");
  grad.addColorStop(0.55, "rgba(255,210,130,0.45)");
  grad.addColorStop(1, "rgba(255,200,120,0)");
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** The shapes of the room. Separate from the meshes so the numbers can be tested (no WebGL needed to count what is in it). */
export function denParts(): { parts: Part[]; lookTargets: LookTarget[] } {
  const z0 = ROOM.back;
  const parts: Part[] = [];
  const looks: LookTarget[] = [];
  const look = (name: string, x: number, y: number, z: number) => looks.push({ name, position: { x, y, z } });

  // Walls: the back one behind the far seats, the others facing in; a wainscot and a skirting along the back.
  parts.push(wall(2 * ROOM.side, ROOM.height, WARM.wall, [0, ROOM.height / 2, z0], 0));
  parts.push(wall(ROOM.front - z0, ROOM.height, WARM.wall, [-ROOM.side, ROOM.height / 2, (ROOM.front + z0) / 2], Math.PI / 2));
  parts.push(wall(ROOM.front - z0, ROOM.height, WARM.wall, [ROOM.side, ROOM.height / 2, (ROOM.front + z0) / 2], -Math.PI / 2));
  parts.push(wall(2 * ROOM.side, ROOM.height, WARM.wall, [0, ROOM.height / 2, ROOM.front], Math.PI));
  parts.push(box(2 * ROOM.side, 0.9, 0.03, WARM.wainscot, [0, 0.45, z0 + 0.015]));
  parts.push(box(2 * ROOM.side, 0.04, 0.05, WARM.trim, [0, 0.92, z0 + 0.025]));
  parts.push(box(2 * ROOM.side, 0.1, 0.05, WARM.trim, [0, 0.05, z0 + 0.025]));

  // The rug under the table: three flat ovals, the ring between a darker middle and the border.
  parts.push(cyl(1, 1, 0.006, WARM.rugOuter, [0, 0.004, 0], 40, undefined, [2.7, 1, 1.85]));
  parts.push(cyl(1, 1, 0.006, WARM.rugRing, [0, 0.008, 0], 40, undefined, [2.45, 1, 1.65]));
  parts.push(cyl(1, 1, 0.006, WARM.rugInner, [0, 0.012, 0], 40, undefined, [2.25, 1, 1.5]));

  // A window with a curtain either side, left of the middle.
  const wx = -1.45;
  const wy = 1.7;
  parts.push(box(1.05, 1.25, 0.05, WARM.trim, [wx, wy, z0 + 0.03]));
  parts.push(box(0.9, 1.1, 0.04, WARM.glass, [wx, wy, z0 + 0.06]));
  parts.push(box(0.05, 1.1, 0.05, WARM.trim, [wx, wy, z0 + 0.07]));
  parts.push(box(0.9, 0.05, 0.05, WARM.trim, [wx, wy, z0 + 0.07]));
  parts.push(box(0.22, 1.45, 0.08, WARM.curtain, [wx - 0.62, wy - 0.05, z0 + 0.07]));
  parts.push(box(0.22, 1.45, 0.08, WARM.curtain, [wx + 0.62, wy - 0.05, z0 + 0.07]));
  parts.push(box(1.7, 0.05, 0.06, WARM.trim, [wx, wy + 0.78, z0 + 0.07]));
  look("window", wx, wy, z0);

  // A bookcase on the right: a frame, four shelves, a row of books on each.
  const bx = 1.45;
  parts.push(box(1, 2, 0.04, WARM.wood, [bx, 1, z0 + 0.02]));
  for (const x of [-0.5, 0.5]) parts.push(box(0.05, 2, 0.32, WARM.trim, [bx + x, 1, z0 + 0.16]));
  for (let s = 0; s < 5; s++) parts.push(box(1, 0.04, 0.32, WARM.trim, [bx, 0.02 + s * 0.48, z0 + 0.16]));
  for (let s = 0; s < 4; s++) {
    let x = bx - 0.43;
    for (let i = 0; i < 7; i++) {
      const w = 0.05 + ((i * 7 + s * 3) % 4) * 0.012;
      const h = 0.26 + ((i * 5 + s * 2) % 4) * 0.03;
      parts.push(box(w, h, 0.2, BOOKS[(i + s * 2) % BOOKS.length]!, [x + w / 2, 0.04 + s * 0.48 + h / 2, z0 + 0.16]));
      x += w + 0.012;
    }
  }
  look("bookcase", bx, 1.3, z0);

  // Pictures and a clock, between the window and the bookcase.
  parts.push(box(0.46, 0.36, 0.04, WARM.trim, [-0.35, 2.0, z0 + 0.025]));
  parts.push(box(0.38, 0.28, 0.04, 0x8fc7a2, [-0.35, 2.0, z0 + 0.04]));
  parts.push(box(0.3, 0.38, 0.04, WARM.trim, [0.2, 1.95, z0 + 0.025]));
  parts.push(box(0.22, 0.3, 0.04, 0xf2b8a0, [0.2, 1.95, z0 + 0.04]));
  parts.push(cyl(0.17, 0.17, 0.05, WARM.trim, [0.78, 2.1, z0 + 0.03], 20, [Math.PI / 2, 0, 0]));
  parts.push(cyl(0.14, 0.14, 0.05, WARM.clock, [0.78, 2.1, z0 + 0.05], 20, [Math.PI / 2, 0, 0]));
  parts.push(box(0.018, 0.1, 0.03, WARM.trim, [0.78, 2.14, z0 + 0.08]));
  parts.push(box(0.07, 0.018, 0.03, WARM.trim, [0.81, 2.1, z0 + 0.08]));
  look("pictures", -0.07, 1.97, z0);
  look("clock", 0.78, 2.1, z0);

  // Plants: a pot and a ball of leaves, one in the left corner, one on the right.
  for (const [px, pz] of [[-2.0, -1.9], [2.35, -1.2]] as const) {
    parts.push(cyl(0.17, 0.12, 0.3, WARM.pot, [px, 0.15, pz]));
    parts.push(ball(0.28, WARM.leaf, [px, 0.62, pz], [1, 1.15, 1]));
    parts.push(ball(0.18, WARM.leafLight, [px + 0.12, 0.85, pz + 0.04]));
    parts.push(ball(0.16, WARM.leafLight, [px - 0.14, 0.78, pz - 0.03]));
    look(px < 0 ? "plant left" : "plant right", px, 0.7, pz);
  }

  // A chair on the left and a sofa against the front wall (what a player sees looking back across the room), each a seat, a back and two arms on short legs.
  const seating = (cx: number, cz: number, yaw: number, width: number, color: number, dark: number) => {
    const turn: [number, number, number] = [0, yaw, 0];
    const at = (x: number, z: number): [number, number] => [cx + x * Math.cos(yaw) + z * Math.sin(yaw), cz - x * Math.sin(yaw) + z * Math.cos(yaw)];
    const put = (w: number, h: number, d: number, y: number, x: number, z: number, c: number) => {
      const [wx, wz] = at(x, z);
      parts.push(box(w, h, d, c, [wx, y, wz], turn));
    };
    put(width, 0.28, 0.75, 0.28, 0, 0, color);
    put(width, 0.6, 0.14, 0.62, 0, -0.34, dark);
    for (const x of [-1, 1]) put(0.14, 0.42, 0.75, 0.42, (x * (width + 0.14)) / 2, 0, dark);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const [wx, wz] = at((x * width) / 2.4, z * 0.3);
      parts.push(box(0.06, 0.14, 0.06, WARM.trim, [wx, 0.07, wz]));
    }
  };
  seating(-2.55, -1.35, 0.55, 0.8, WARM.sofa, WARM.sofaDark);
  look("armchair", -2.55, 0.6, -1.35);
  seating(0, 4.3, Math.PI, 2.2, WARM.sofa, WARM.sofaDark);
  look("sofa", 0, 0.6, 4.3);
  // Over the sofa, a long picture and two small ones; a picture on each side wall.
  parts.push(box(1.2, 0.5, 0.04, WARM.trim, [0, 1.6, ROOM.front - 0.025]));
  parts.push(box(1.1, 0.4, 0.04, 0xf2c98a, [0, 1.6, ROOM.front - 0.04]));
  for (const x of [-1.1, 1.1]) {
    parts.push(box(0.4, 0.4, 0.04, WARM.trim, [x, 1.55, ROOM.front - 0.025]));
    parts.push(box(0.32, 0.32, 0.04, x < 0 ? 0xa6dcf2 : 0xf2b8a0, [x, 1.55, ROOM.front - 0.04]));
  }
  for (const side of [-1, 1]) {
    parts.push(box(0.04, 0.55, 0.8, WARM.trim, [side * (ROOM.side - 0.025), 1.7, 1.0]));
    parts.push(box(0.04, 0.45, 0.7, side < 0 ? 0x8fc7a2 : 0xe98c5c, [side * (ROOM.side - 0.04), 1.7, 1.0]));
  }

  return { parts, lookTargets: looks };
}

/** Where the lamp hangs over the table, and the size of the pool of light it throws on the felt. */
export const PENDANT = { y: 2.2, shade: 0.3 } as const;

export function buildDen(tableY: number): Den {
  const { parts, lookTargets } = denParts();
  const geometry = merged(parts);
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const room = new Mesh(geometry, mat);
  room.frustumCulled = false;
  const group = new Group();
  group.add(room);

  // The lamp: a cord, a shade and a bulb, one more draw call.
  const lampParts: Part[] = [
    cyl(0.01, 0.01, ROOM.height - PENDANT.y, WARM.trim, [0, (ROOM.height + PENDANT.y) / 2, 0], 6),
    cyl(0.07, PENDANT.shade, 0.2, WARM.lamp, [0, PENDANT.y + 0.1, 0], 16),
    ball(0.07, WARM.bulb, [0, PENDANT.y - 0.02, 0]),
  ];
  const lampGeo = merged(lampParts);
  const lamp = new Mesh(lampGeo, new MeshBasicMaterial({ vertexColors: true }));
  lamp.frustumCulled = false;
  lamp.position.y = 0;
  group.add(lamp);
  lookTargets.push({ name: "lamp", position: { x: 0, y: PENDANT.y, z: 0 } });

  // The pool of light on the felt: a soft additive disc just above it, no shadow map.
  const pool = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.5 }));
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(TABLE_A * 1.3, TABLE_B * 1.3, 1);
  pool.position.y = tableY + 0.004;
  pool.renderOrder = 1;
  group.add(pool);

  const triangles = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position!.count) / 3;
  return {
    group,
    setPendantVisible: (visible) => {
      lamp.visible = visible;
    },
    lookTargets,
    triangles: triangles(geometry) + triangles(lampGeo) + 2,
  };
}
