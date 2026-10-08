import { AmbientLight, Box3, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { Blinker, idlePose, mulberry32 } from "./behaviour.ts";
import { frameFromEyeLevel } from "./framing.ts";
import type { AvatarRenderer, VisemeWeights } from "./renderer.ts";
import type { VrmAvatar } from "./vrm-avatar.ts";

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Match the drawing buffer and camera aspect to `width` x `height`, or to the canvas's CSS size. */
  resize(width?: number, height?: number): void;
}

/** A WebGL scene with the standard soft lighting. The caller decides how often to render. `background` is a 0xRRGGBB colour; omit it for a transparent canvas. */
export function createStage(canvas: HTMLCanvasElement, opts: { pixelRatio?: number; background?: number } = {}): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(opts.pixelRatio ?? Math.min(globalThis.devicePixelRatio ?? 1, 2));
  // Transparent by default (for OBS and the demo page). A video stream needs an opaque background:
  // transparent pixels turn black or white depending on the encoder and the viewer.
  if (opts.background !== undefined) renderer.setClearColor(opts.background, 1);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.6));
  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(1, 2, 2);
  scene.add(key);
  const camera = new PerspectiveCamera(28, 1, 0.1, 20);
  const resize = (width?: number, height?: number) => {
    const w = width ?? (canvas.clientWidth || window.innerWidth);
    const h = height ?? (canvas.clientHeight || window.innerHeight);
    renderer.setSize(w, h, width === undefined); // only touch CSS size when following the canvas's own
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize(undefined, undefined);
  return { renderer, scene, camera, resize };
}

/** Put the camera at the avatar's eye line, looking straight ahead, with the head in view. */
export function frameAvatar(camera: PerspectiveCamera, avatar: VrmAvatar): { eyeBones: boolean } {
  const head = avatar.headPosition();
  const top = new Box3().setFromObject(avatar.scene).max.y;
  const framing = frameFromEyeLevel(avatar.eyeLevel(), head.y, top, camera.fov);
  camera.position.set(head.x, framing.y, head.z + framing.distance);
  camera.lookAt(head.x, framing.y, head.z);
  return { eyeBones: avatar.hasEyeBones() };
}

/** Everything that makes an avatar look alive each frame: mouth, blinking, idle sway. */
export class Puppet {
  private readonly blinker: Blinker;
  private elapsed = 0;
  /** Eyelid closure and mouth weights applied on the last update. */
  blink = 0;
  visemes: VisemeWeights = {};

  constructor(
    private readonly avatar: AvatarRenderer,
    seed: number,
  ) {
    this.blinker = new Blinker(mulberry32(seed));
  }

  get blinks(): number {
    return this.blinker.blinks;
  }

  triggerBlink(): void {
    this.blinker.trigger();
  }

  update(dt: number, mouth: VisemeWeights): void {
    this.elapsed += dt;
    this.visemes = mouth;
    this.avatar.setVisemes(mouth);
    this.blink = this.blinker.update(dt);
    this.avatar.setBlink(this.blink);
    this.avatar.setHeadPose(idlePose(this.elapsed));
    this.avatar.update(dt);
  }
}
