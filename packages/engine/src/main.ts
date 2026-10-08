import { Box3, Clock, DirectionalLight, AmbientLight, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { VrmAvatar } from "./vrm-avatar.ts";
import { AudioSession } from "./audio-session.ts";
import { Blinker, idlePose, mulberry32 } from "./behaviour.ts";
import { mountDemoPanel } from "./demo-panel.ts";
import { frameFromEyeLevel } from "./framing.ts";
import type { VisemeWeights } from "./renderer.ts";

const params = new URLSearchParams(location.search);
const hud = document.getElementById("hud");
if (hud && params.get("hud") === "0") hud.hidden = true;
const say = (text: string) => {
  if (hud) hud.textContent = text;
};

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
new ResizeObserver(resize).observe(canvas);
resize();

/** Test and driver hook. */
declare global {
  interface Window {
    __vikaki?: {
      ready: boolean;
      avatar?: unknown;
      /** "idle" until a mic is requested, then "listening" or "error". */
      mic: "idle" | "listening" | "error";
      /** The mouth weights applied on the last frame. */
      visemes: VisemeWeights;
      /** Eyelid closure applied on the last frame, and how many blinks have started. */
      blink: number;
      blinks: number;
      setVisemes(w: VisemeWeights): void;
      /** True if the avatar has eye bones; false means eye level is estimated. */
      eyeBones?: boolean;
    };
  }
}
const api: NonNullable<Window["__vikaki"]> = { ready: false, mic: "idle", visemes: {}, blink: 0, blinks: 0, setVisemes: () => {} };
window.__vikaki = api;

const baseUrl = import.meta.env.BASE_URL;
const avatarUrl = params.get("avatar") ?? `${baseUrl}avatars/teddy.vrm`;
const demo = params.get("demo") === "1";
const seed = Number(params.get("seed") ?? Date.now());
const session = new AudioSession(`${baseUrl}profiles/default.bin`);

try {
  const avatar = await VrmAvatar.load(avatarUrl);
  scene.add(avatar.scene);
  // Camera at the avatar's eye level, looking straight ahead, so we are never looking up at it.
  const head = avatar.headPosition();
  const top = new Box3().setFromObject(avatar.scene).max.y;
  const eyeY = avatar.eyeLevel();
  const framing = frameFromEyeLevel(eyeY, head.y, top, camera.fov);
  camera.position.set(head.x, framing.y, head.z + framing.distance);
  camera.lookAt(head.x, framing.y, head.z);
  api.eyeBones = avatar.hasEyeBones();

  let manual: VisemeWeights = {};
  api.avatar = avatar;
  api.setVisemes = (w) => {
    manual = w;
  };

  const blinker = new Blinker(mulberry32(seed));

  /** Start the mic. A failure leaves the avatar idle with a visible error, never a frozen frame. */
  async function startMic(): Promise<void> {
    try {
      await session.startMic();
      api.mic = "listening";
      say(session.state === "running" ? "vikaki · mic on" : "vikaki · click the page to start the mic");
      panel?.setMic(true);
      panel?.status("");
    } catch (err) {
      api.mic = "error";
      console.error(err);
      say(`mic error: ${(err as Error).message}`);
      panel?.setMic(false);
      panel?.status(`Mic error: ${(err as Error).message}`);
    }
  }
  function stopMic(): void {
    session.stopMic();
    api.mic = "idle";
    say("vikaki");
    panel?.setMic(false);
  }

  const panel = demo
    ? mountDemoPanel({
        hold: (w) => (manual = w),
        blink: () => blinker.trigger(),
        toggleMic: async () => (session.listening ? stopMic() : startMic()),
        playFile: async (f) => {
          panel?.status(`Playing ${f.name}…`);
          api.mic = "idle";
          panel?.setMic(false);
          try {
            await session.playFile(f);
            panel?.status("");
          } catch (err) {
            panel?.status(`Could not play that file: ${(err as Error).message}`);
          }
        },
      })
    : undefined;

  api.ready = true;
  say("vikaki");

  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const held = Object.keys(manual).length > 0;
    api.visemes = held ? manual : (session.lipsync?.weights ?? {});
    avatar.setVisemes(api.visemes);
    api.blink = blinker.update(dt);
    api.blinks = blinker.blinks;
    avatar.setBlink(api.blink);
    avatar.setHeadPose(idlePose(clock.elapsedTime));
    avatar.update(dt);
    renderer.render(scene, camera);
    panel?.update({ visemes: api.visemes, blink: api.blink, volume: session.lipsync?.volume ?? 0 });
  });

  if (params.get("mode") === "mic") {
    const resume = () => void session.resume(); // a click may be needed before audio starts
    window.addEventListener("pointerdown", resume, { once: true });
    await startMic();
  }
} catch (err) {
  console.error(err);
  say(`error: ${(err as Error).message}`);
}
