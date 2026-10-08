import { AmbientLight, Box3, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { Blinker, idlePose, mulberry32 } from "./behaviour.ts";
import { EmotionState } from "./emotion.ts";
import { Gestures } from "./gestures.ts";
import { frameFromEyeLevel } from "./framing.ts";
import { VISEMES, type AvatarRenderer, type HeadPose, type VisemeWeights } from "./renderer.ts";
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
    // Never write an inline CSS size: it would beat the stylesheet and stop the canvas shrinking beside a side panel.
    renderer.setSize(w, h, false);
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
  /** The feeling on show. Set it from the driver's `emotion`; it eases in and out by itself. */
  readonly emotion = new EmotionState();
  /** Nods, lifts and blinks answering the voice (mic mode). Feed it the cues from `ProsodyTracker`. */
  readonly gestures = new Gestures();
  /** The head pose applied on the last update, in radians, and how much of it came from voice gestures. */
  head: HeadPose = { pitch: 0, yaw: 0, roll: 0 };
  gesture = { pitch: 0, roll: 0 };
  /** Eyelid closure and mouth weights applied on the last update. */
  blink = 0;
  visemes: VisemeWeights = {};
  /** What the avatar showed after the last update, when the renderer can say. Else the same as `visemes`. */
  applied: VisemeWeights = {};

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
    const pose = this.emotion.update(dt);
    this.visemes = mouth; // what lip sync asked for; the resting mouth is layered on below
    this.avatar.setVisemes(withRestMouth(mouth, pose.rest));
    const gesture = (this.gesture = this.gestures.update(dt));
    if (this.gestures.takeBlink()) this.blinker.trigger();
    this.blink = Math.max(this.blinker.update(dt), pose.squint);
    this.avatar.setBlink(this.blink);
    const idle = idlePose(this.elapsed);
    const tau = Math.PI * 2;
    this.head = {
      pitch: idle.pitch + pose.pitch + gesture.pitch + pose.bob * 0.05 * Math.sin(tau * 1.8 * this.elapsed),
      yaw: idle.yaw + pose.yaw + pose.shake * 0.03 * Math.sin(tau * 9 * this.elapsed),
      roll: idle.roll + pose.roll + gesture.roll,
    };
    this.avatar.setHeadPose(this.head);
    this.avatar.update(dt);
    this.applied = this.avatar.appliedVisemes?.() ?? mouth;
  }
}

/** The emotion's resting mouth, faded out as lip sync opens the mouth, so a smile never stacks on a spoken vowel. */
function withRestMouth(mouth: VisemeWeights, rest: VisemeWeights): VisemeWeights {
  const speaking = Math.min(1, Math.max(0, ...VISEMES.map((v) => mouth[v] ?? 0)));
  if (speaking >= 1 || Object.keys(rest).length === 0) return mouth;
  const out: VisemeWeights = { ...mouth };
  for (const v of VISEMES) if (rest[v]) out[v] = Math.min(1, (mouth[v] ?? 0) + rest[v]! * (1 - speaking));
  return out;
}
