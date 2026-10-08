import { Box3, Clock, DirectionalLight, AmbientLight, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { VrmAvatar } from "./vrm-avatar.ts";
import type { AvatarRenderer, VisemeWeights } from "./renderer.ts";

const params = new URLSearchParams(location.search);
const hud = document.getElementById("hud");
if (hud && params.get("hud") === "0") hud.hidden = true;

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 1.6));
const key = new DirectionalLight(0xffffff, 1.4);
key.position.set(1, 2, 2);
scene.add(key);

const camera = new PerspectiveCamera(28, 1, 0.1, 20);

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

/** Test and driver hook. Lip sync (V1.4) will replace manual calls to setVisemes. */
declare global {
  interface Window {
    __vikaki?: { ready: boolean; avatar?: AvatarRenderer; setVisemes(w: VisemeWeights): void };
  }
}
const api: NonNullable<Window["__vikaki"]> = { ready: false, setVisemes: () => {} };
window.__vikaki = api;

const avatarUrl = params.get("avatar") ?? `${import.meta.env.BASE_URL}avatars/teddy.vrm`;

try {
  const avatar = await VrmAvatar.load(avatarUrl);
  scene.add(avatar.scene);
  // Frame the head: from the head bone (base of the skull) up to the top of the model.
  const head = avatar.headPosition();
  const top = new Box3().setFromObject(avatar.scene).max.y;
  const headHeight = Math.max(top - head.y, 0.1);
  const centerY = head.y + headHeight / 2;
  const distance = (headHeight * 2.0) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  camera.position.set(head.x, centerY, head.z + distance);
  camera.lookAt(head.x, centerY, head.z);
  api.avatar = avatar;
  api.setVisemes = (w) => avatar.setVisemes(w);
  api.ready = true;

  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    avatar.update(clock.getDelta());
    renderer.render(scene, camera);
  });
  if (hud) hud.textContent = "vikaki";
} catch (err) {
  console.error(err);
  if (hud) hud.textContent = `error: ${(err as Error).message}`;
}
