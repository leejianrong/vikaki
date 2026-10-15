// VIK-60 spike: three avatars seated at a table with their arms on it, cards and chips as plain meshes, seen from a few cameras.
// Question: is a 3D table worth having next to the bust row (`?seats=3`), and does it change the renderer contract? Throwaway code.
//   ?cam=bust|high|low|top   ?arms=off (arms hang, as the bust row does)   ?seated=off (standing, legs straight)
import {
  AmbientLight, BoxGeometry, CanvasTexture, CylinderGeometry, DirectionalLight, Euler, Group, Mesh, MeshStandardMaterial, PerspectiveCamera,
  PlaneGeometry, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { VrmAvatar } from "../../packages/engine/src/vrm-avatar.ts";

const q = new URLSearchParams(location.search);
const cam = q.get("cam") ?? "high";
const armsOn = q.get("arms") !== "off";
const seated = q.get("seated") !== "off";
const looks = ["/avatars/cookieman.vrm", "/avatars/snowy.vrm", "/avatars/cookieman.vrm"];

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x101418, 1);
const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 1.7));
const key = new DirectionalLight(0xffffff, 1.5);
key.position.set(1, 3, 2);
scene.add(key);

const mat = (c: number, rough = 0.8) => new MeshStandardMaterial({ color: c, roughness: rough });

// ---- the people ----
const avatars = await Promise.all(looks.map((u) => VrmAvatar.load(u)));
const H = Math.max(...avatars.map((a) => a.framing().top)); // tallest, including Snowy's hat
const R = 0.95; // seat radius
const TABLE_R = 0.78;
const angles = [-0.95, 0, 0.95]; // radians around the far half of the table
const hips = avatars.map((a) => a.vrm.humanoid.getNormalizedBoneNode("hips")!.getWorldPosition(new Vector3()).y);
const DROP = seated ? 0.45 * Math.min(...hips) : 0; // sitting lowers the hips to chair height

/** Rest the hands on the table: the upper arm swings forward and down, the elbow bends in. Angles are the tuned result of the spike. */
function armsOnTable(a: VrmAvatar): void {
  const h = a.vrm.humanoid;
  for (const side of ["left", "right"] as const) {
    const s = side === "left" ? 1 : -1; // the left arm points along +x in the T-pose
    const upper = h.getNormalizedBoneNode(`${side}UpperArm`);
    const lower = h.getNormalizedBoneNode(`${side}LowerArm`);
    if (upper) upper.quaternion.copy(new Quaternion().setFromEuler(new Euler(0, -s * 1.0, 0)).multiply(new Quaternion().setFromEuler(new Euler(0, 0, s * 1.0))));
    if (lower) lower.quaternion.setFromEuler(new Euler(0, -s * 0.9, 0));
  }
}

/** Sit: thighs forward, shins down. A model with no leg bones just keeps standing legs, and the table hides them. */
function sit(a: VrmAvatar): void {
  const h = a.vrm.humanoid;
  for (const side of ["left", "right"] as const) {
    h.getNormalizedBoneNode(`${side}UpperLeg`)?.quaternion.setFromEuler(new Euler(-Math.PI / 2 + 0.1, 0, 0));
    h.getNormalizedBoneNode(`${side}LowerLeg`)?.quaternion.setFromEuler(new Euler(Math.PI / 2 - 0.1, 0, 0));
  }
}

// Pose first, then set the table where the hands ended up: the table height is the posed hands' height, not a number.
const people = new Group();
scene.add(people);
avatars.forEach((a, i) => {
  const x = R * Math.sin(angles[i]!);
  const z = -R * Math.cos(angles[i]!);
  if (armsOn) armsOnTable(a);
  else a.lowerArms();
  if (seated) sit(a);
  a.scene.position.set(x, -DROP, z);
  a.scene.rotation.y = Math.PI + Math.atan2(-x, -z); // the loader already turned VRM 0.x by pi to face +z; now face the middle of the table
  people.add(a.scene);
  a.vrm.update(0);
});

const handY = avatars.map((a) => {
  const h = a.vrm.humanoid;
  const ys = (["leftHand", "rightHand"] as const).map((n) => h.getNormalizedBoneNode(n)!.getWorldPosition(new Vector3()).y);
  return (ys[0]! + ys[1]!) / 2;
});
const TABLE_Y = [...handY].sort((x, y) => x - y)[1]! - 0.03; // the middle one, so one odd avatar does not set the height

// ---- the table ----
const table = new Group();
scene.add(table);
const top = new Mesh(new CylinderGeometry(TABLE_R, TABLE_R, 0.05, 64), mat(0x2f7a4d, 0.95));
top.position.y = TABLE_Y - 0.025;
table.add(top);
const rim = new Mesh(new CylinderGeometry(TABLE_R + 0.06, TABLE_R + 0.06, 0.07, 64), mat(0x7a4a24, 0.6));
rim.position.y = TABLE_Y - 0.04;
table.add(rim);
const pedestal = new Mesh(new CylinderGeometry(0.18, 0.3, TABLE_Y, 24), mat(0x4a3018));
pedestal.position.y = TABLE_Y / 2 - 0.05;
table.add(pedestal);
const floor = new Mesh(new PlaneGeometry(8, 8), mat(0x1c232b, 1));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// ---- cards and chips ----
function cardTexture(text: string, red: boolean): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 180;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fffaf3";
  g.fillRect(0, 0, 128, 180);
  g.strokeStyle = "#c9b8a6";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 174);
  g.fillStyle = red ? "#c0392b" : "#222";
  g.font = "700 64px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 92);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
const CARD = { w: 0.07, h: 0.1, t: 0.002 };
function card(face: string | null, red = false): Mesh {
  const faceMat = face ? new MeshStandardMaterial({ map: cardTexture(face, red), roughness: 0.6 }) : mat(0xb45f23, 0.6);
  // box faces: +x -x +y -y +z -z; the top (+y) shows the face
  const edge = mat(0xfffaf3, 0.6);
  return new Mesh(new BoxGeometry(CARD.w, CARD.t, CARD.h), [edge, edge, faceMat, edge, edge, edge]);
}
const COLOURS = [0xd64545, 0x3b6fd6, 0xf2c94c, 0x2c2c2c];
function chips(n: number, colour: number): Group {
  const g = new Group();
  for (let i = 0; i < n; i++) {
    const c = new Mesh(new CylinderGeometry(0.022, 0.022, 0.008, 20), mat(colour, 0.4));
    c.position.y = 0.004 + i * 0.0085;
    g.add(c);
  }
  return g;
}
const on = (o: Mesh | Group, x: number, z: number, rot = 0) => {
  o.position.x = x;
  o.position.z = z;
  o.position.y += TABLE_Y;
  o.rotation.y = rot;
  table.add(o);
};
angles.forEach((ang) => {
  const dirX = Math.sin(ang);
  const dirZ = -Math.cos(ang);
  const r = 0.5; // cards sit this far from the middle
  const yaw = Math.atan2(-dirX, -dirZ);
  for (const k of [-1, 1]) {
    const c = card(null);
    on(c, dirX * r + Math.cos(yaw) * k * 0.045, dirZ * r - Math.sin(yaw) * k * 0.045, yaw + k * 0.12);
  }
  const cx = dirX * 0.62 + Math.cos(yaw) * 0.16;
  const cz = dirZ * 0.62 - Math.sin(yaw) * 0.16;
  [5, 3, 2].forEach((n, j) => on(chips(n, COLOURS[j]!), cx + Math.cos(yaw) * j * 0.05, cz - Math.sin(yaw) * j * 0.05));
});
(
  [
    ["A♠", false],
    ["7♦", true],
    ["7♣", false],
  ] as const
).forEach(([t, red], j) => on(card(t, red), (j - 1) * 0.085, 0.05, 0));
on(chips(6, COLOURS[0]!), -0.1, -0.1);
on(chips(4, COLOURS[1]!), 0.1, -0.12);
const button = new Mesh(new CylinderGeometry(0.025, 0.025, 0.006, 24), mat(0xf5f0e6, 0.4));
button.position.y = 0.003;
on(button, -0.45, -0.55);

// ---- the camera ----
const views: Record<string, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  // As the bust row does today: eye line, straight on, no table in view.
  bust: { pos: [0, 1.25, 2.9], look: [0, 1.25, 0], fov: 28 },
  // Three-quarter from the near side, above the table.
  high: { pos: [0, 2.0, 2.5], look: [0, TABLE_Y + 0.1, -0.35], fov: 36 },
  // Closer and lower: faces still readable, table edge in the foreground.
  low: { pos: [0, 1.45, 2.2], look: [0, TABLE_Y + 0.35, -0.5], fov: 36 },
  top: { pos: [0, 3.2, 0.4], look: [0, TABLE_Y, -0.2], fov: 40 },
};
const v = views[cam] ?? views.high!;
const camera = new PerspectiveCamera(v.fov, innerWidth / innerHeight, 0.05, 30);
camera.position.set(...v.pos);
camera.lookAt(...v.look);
if (cam === "bust") table.visible = false;

renderer.render(scene, camera);
const info = renderer.info.render;
const t0 = performance.now();
for (let i = 0; i < 30; i++) renderer.render(scene, camera); // software WebGL here, so only the ratio between views means anything
const ms = (performance.now() - t0) / 30;
(window as unknown as Record<string, unknown>).__spike = { ready: true, calls: info.calls, triangles: info.triangles, cam, H, TABLE_Y, handY, ms: Math.round(ms * 10) / 10 };
