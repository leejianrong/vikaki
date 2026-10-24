import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CameraRig, crowded, ease, parseShot, shotFor, type Shot, type ShotContext, type ShotName } from "./cameras.ts";
import { ovalSeats, TABLE_A, TABLE_B } from "./table3d.ts";

const spots = ovalSeats(3);
const heads = spots.map((s) => ({ x: s.x, y: 1.0, z: s.z }));
const eyes = heads.map((h, i) => ({ x: h.x, y: h.y + 0.1 + i * 0.02, z: h.z }));
const tops = [1.35, 1.3, 1.4]; // different heights: a hat, a round head, a tall one
const ctx = (aspect: number): ShotContext => ({ tableY: 0.7, spots, heads, tops, eyes, aspect, fov: 38 });

function camera(shot: Shot, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(shot.fov, aspect, 0.1, 50);
  cam.position.set(shot.position.x, shot.position.y, shot.position.z);
  cam.lookAt(shot.target.x, shot.target.y, shot.target.z);
  cam.updateMatrixWorld();
  return cam;
}
const inView = (cam: PerspectiveCamera, p: { x: number; y: number; z: number }) => {
  const v = new Vector3(p.x, p.y, p.z).project(cam);
  return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1;
};

describe("shotFor", () => {
  for (const aspect of [1.0, 1.3, 1.78, 2.2]) {
    it(`frames the whole table in the wide and overhead shots at aspect ${aspect}, with three players`, () => {
      for (const name of ["wide", "overhead"] as ShotName[]) {
        const cam = camera(shotFor(name, ctx(aspect)), aspect);
        for (const [x, z] of [[-TABLE_A, 0], [TABLE_A, 0], [0, TABLE_B], [0, -TABLE_B]] as const) expect(inView(cam, { x, y: 0.7, z }), `${name} table edge ${x},${z}`).toBe(true);
        if (name === "wide") for (const h of heads) expect(inView(cam, h), `wide head ${h.x}`).toBe(true);
      }
    });
  }

  it("looks each close-up at its player's head, from the front, with the head near the middle of the picture", () => {
    heads.forEach((h, i) => {
      const shot = shotFor(`seat:${i}`, ctx(1.6));
      const cam = camera(shot, 1.6);
      const v = new Vector3(h.x, h.y, h.z).project(cam);
      expect(Math.abs(v.x)).toBeLessThan(0.1);
      expect(Math.abs(v.y)).toBeLessThan(0.25);
      // the whole avatar's top is in the picture, with room to spare, whatever its height
      expect(inView(cam, { x: h.x, y: tops[i]! + 0.05, z: h.z }), `top of ${i}`).toBe(true);
      // in front of the face: the camera is on the side of the table the player faces
      const toCam = { x: shot.position.x - h.x, z: shot.position.z - h.z };
      expect(toCam.x * Math.sin(spots[i]!.facing) + toCam.z * Math.cos(spots[i]!.facing)).toBeGreaterThan(1);
    });
  });

  it("fills the picture with the board in the board shot: its cards fit, and it is much closer than the wide shot", () => {
    for (const aspect of [1.0, 1.6, 2.2]) {
      const shot = shotFor("board", ctx(aspect));
      const cam = camera(shot, aspect);
      for (const x of [-0.5, 0, 0.5]) expect(inView(cam, { x, y: 0.7, z: 0 }), `board card at ${x}, aspect ${aspect}`).toBe(true);
      expect(Math.hypot(shot.position.x - shot.target.x, shot.position.y - shot.target.y, shot.position.z - shot.target.z)).toBeLessThan(
        Math.hypot(shotFor("wide", ctx(aspect)).position.x - shotFor("wide", ctx(aspect)).target.x, shotFor("wide", ctx(aspect)).position.y - shotFor("wide", ctx(aspect)).target.y, shotFor("wide", ctx(aspect)).position.z - shotFor("wide", ctx(aspect)).target.z) * 0.7,
      );
    }
  });

  for (const aspect of [1.0, 1.6, 2.2]) {
    it(`shows the next player and the table from a player's eyes, at aspect ${aspect}`, () => {
      heads.forEach((_, i) => {
        const shot = shotFor(`pov:${i}`, ctx(aspect));
        const cam = camera(shot, aspect);
        expect(shot.position).toEqual(eyes[i]); // from the eyes
        // the next player round the table is in the picture, with the middle of the table
        expect(inView(cam, heads[(i + 1) % heads.length]!), `player ${(i + 1) % 3} seen from ${i} at aspect ${aspect}`).toBe(true);
        expect(inView(cam, { x: 0, y: 0.7, z: 0 }), `the table's middle from ${i}`).toBe(true);
        expect(shot.fov).toBeGreaterThanOrEqual(45);
        expect(shot.fov).toBeLessThanOrEqual(90);
      });
    });
  }

  it("rests the camera on the wide shot for the grid, which the page draws tile by tile", () => {
    expect(shotFor("grid", ctx(1.6))).toEqual(shotFor("wide", ctx(1.6)));
  });

  it("looks straight down in the overhead shot", () => {
    const s = shotFor("overhead", ctx(1.6));
    expect(s.position.y).toBeGreaterThan(s.target.y + 2);
    expect(Math.hypot(s.position.x - s.target.x, s.position.z - s.target.z)).toBeLessThan(0.1);
  });
});

describe("parseShot", () => {
  it("knows wide, overhead and a seat that exists", () => {
    expect(["wide", "overhead", "board", "grid", "seat:2", "pov:1", "seat:3", "pov:3", "seat:x", null, "crane"].map((v) => parseShot(v, 3))).toEqual(["wide", "overhead", "board", "grid", "seat:2", "pov:1", undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("CameraRig", () => {
  const a = shotFor("wide", ctx(1.6));
  const b = shotFor("overhead", ctx(1.6));
  const c = shotFor("seat:1", ctx(1.6));
  const dist = (p: Shot["position"], q: Shot["position"]) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

  it("starts where it is told, ends exactly on the new shot, and never takes a step bigger than the glide allows", () => {
    const rig = new CameraRig(a);
    expect(rig.shot).toEqual(a);
    rig.moveTo(b, 1);
    let prev = rig.shot.position;
    let biggest = 0;
    for (let t = 0; t < 1.5; t += 0.016) {
      const p = rig.update(0.016).position;
      biggest = Math.max(biggest, dist(prev, p));
      prev = p;
    }
    expect(rig.moving).toBe(false);
    expect(rig.shot.position).toEqual(b.position);
    expect(biggest).toBeLessThan(dist(a.position, b.position) * 0.05); // at 60 fps no frame moves it 5% of the way
  });

  it("a shot asked for halfway through a glide starts from where the camera is, so there is no jump", () => {
    const rig = new CameraRig(a);
    rig.moveTo(b, 1);
    for (let i = 0; i < 20; i++) rig.update(0.016);
    const mid = rig.shot.position;
    rig.moveTo(c, 1);
    expect(dist(rig.update(0.0001).position, mid)).toBeLessThan(0.01);
  });

  it("a frame that took far too long moves it no further than a frame of 50 ms would", () => {
    const rig = new CameraRig(a);
    rig.moveTo(b, 1);
    const p = rig.update(10).position;
    expect(dist(p, a.position)).toBeLessThan(dist(a.position, b.position) * 0.05);
  });

  it("sets at once for a duration of zero, and a resize retargets without restarting", () => {
    const rig = new CameraRig(a);
    rig.moveTo(b, 0);
    expect(rig.shot).toEqual(b);
    rig.moveTo(c, 1);
    for (let i = 0; i < 10; i++) rig.update(0.016);
    const still = shotFor("seat:1", ctx(2.0));
    rig.retarget(still);
    expect(rig.moving).toBe(true);
    for (let i = 0; i < 100; i++) rig.update(0.016);
    expect(rig.shot.position).toEqual(still.position);
  });

  it("eases slowly at both ends", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });
});

describe("a table of six or seven (VIK-88)", () => {
  const many = (n: number) => {
    const sp = ovalSeats(n);
    const hs = sp.map((s) => ({ x: s.x, y: 1.0, z: s.z }));
    return { sp, hs, ctx: (aspect: number): ShotContext => ({ tableY: 0.7, spots: sp, heads: hs, tops: hs.map(() => 1.4), eyes: hs.map((h) => ({ ...h, y: 1.1 })), aspect, fov: 38 }) };
  };

  it("puts seats on the near side from five up, and not before", () => {
    expect(crowded(ovalSeats(3))).toBe(false);
    expect(crowded(ovalSeats(4))).toBe(false);
    for (const n of [5, 6, 7, 8]) expect(crowded(ovalSeats(n)), `${n} seats`).toBe(true);
  });

  for (const n of [5, 6, 7, 8]) {
    it(`looks down over the near seats' heads at ${n} seats, so none of them hides the middle of the table, with every head and the board in view`, () => {
      const { sp, hs, ctx: c } = many(n);
      for (const aspect of [1, 1.6, 2]) {
        const shot = shotFor("wide", c(aspect));
        const cam = camera(shot, aspect);
        for (const h of hs) expect(inView(cam, h), `${n} seats, aspect ${aspect}, head at ${h.x.toFixed(2)},${h.z.toFixed(2)}`).toBe(true);
        for (const x of [-0.5, 0, 0.5]) expect(inView(cam, { x, y: 0.7, z: -0.14 })).toBe(true);
        for (const [i, s] of sp.entries()) {
          if (s.z < 0.3 || Math.abs(s.x) > 0.6) continue; // the ones the line passes near (the camera is on the middle line)
          // the line from the camera to the middle of the table, where it passes this near seat, is above the seat's head
          const k = s.z / shot.position.z;
          const lineY = 0.7 + (shot.position.y - 0.7) * k;
          expect(lineY, `near seat ${i} of ${n}`).toBeGreaterThan(1.4);
        }
      }
    });

    it(`keeps every close-up and the board shot clear of the other heads at ${n} seats`, () => {
      const { hs, ctx: c } = many(n);
      for (let i = 0; i < n; i++) {
        const shot = shotFor(`seat:${i}`, c(1.6));
        for (const [j, h] of hs.entries()) if (j !== i) expect(Math.hypot(shot.position.x - h.x, shot.position.y - h.y, shot.position.z - h.z), `close-up ${i} against head ${j}`).toBeGreaterThan(0.5);
        expect(inView(camera(shot, 1.6), hs[i]!), `own head ${i}`).toBe(true);
      }
      const board = shotFor("board", c(1.6));
      for (const h of hs) expect(Math.hypot(board.position.x - h.x, board.position.z - h.z), "the board camera is not in anyone's head").toBeGreaterThan(0.6);
      for (const x of [-0.5, 0, 0.5]) expect(inView(camera(board, 1.6), { x, y: 0.7, z: -0.14 })).toBe(true);
    });
  }
});
