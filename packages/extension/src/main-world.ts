// Runs inside the meeting page itself (world: MAIN) so it can replace the page's own camera.
//
// What it does:
//  - getUserMedia({video}) returns the avatar canvas as the video track. The physical camera is
//    never requested, so a camera blocked by policy makes no difference.
//  - The real microphone is still used for the call, and also tapped (locally) to lip-sync the avatar.
//  - enumerateDevices lists one video input, "Vikaki Avatar", and hides real cameras.
//  - permissions.query for "camera" answers "granted", so the page does not disable its camera button.
import { createMouthDriver, type MouthDriver } from "@vikaki/engine/mouth.ts";
import { createStage, frameAvatar, Puppet } from "@vikaki/engine/stage.ts";
import { VrmAvatar } from "@vikaki/engine/vrm-avatar.ts";
import { REQUEST, RESPONSE, type Assets } from "./protocol.ts";

const CAMERA_ID = "vikaki-avatar-camera";
const CAMERA_LABEL = "Vikaki Avatar";
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
/** Soft sky blue behind the avatar. Opaque, because a video stream cannot carry transparency. */
const BACKGROUND = 0xcfe9f5;

/** Read-only diagnostics for tests and for debugging a real call from the page console. */
const debug = {
  avatarReady: false,
  mouthKind: undefined as string | undefined,
  mouthReason: undefined as string | undefined,
  /** The strongest mouth weight on the last frame. */
  mouth: 0,
  /** Times the page asked for video and we served the avatar. */
  videoRequestsServed: 0,
  /** Times we passed a video request to the real browser. Must stay 0. */
  physicalCameraRequests: 0,
  error: undefined as string | undefined,
};
Object.defineProperty(window, "__vikakiExt", { value: debug, enumerable: false });

// ---- assets, fetched by the isolated-world bridge (the page's CSP may block fetching them here) ----

let assetsPromise: Promise<Assets> | undefined;

function requestAssets(): Promise<Assets> {
  assetsPromise ??= new Promise<Assets>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the Vikaki extension bridge did not answer")), 10_000);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.type !== RESPONSE) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve({ vrm: e.data.vrm, profile: e.data.profile });
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: REQUEST }, window.location.origin);
  }).catch((err) => {
    assetsPromise = undefined; // allow a retry on the next request
    throw err;
  });
  return assetsPromise;
}

// ---- audio side: tap the real mic to drive the mouth ----

let currentMouth: MouthDriver | undefined;
let audioPromise: Promise<{ ctx: AudioContext; mouth: MouthDriver }> | undefined;

function ensureAudio() {
  audioPromise ??= (async () => {
    const assets = await requestAssets();
    const ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const created = await createMouthDriver(ctx, assets.profile);
    debug.mouthKind = created.kind;
    debug.mouthReason = created.reason;
    currentMouth = created.driver;
    return { ctx, mouth: created.driver };
  })().catch((err) => {
    audioPromise = undefined;
    throw err;
  });
  return audioPromise;
}

/** Lip-sync from a mic stream. Never lets a problem here break the call itself. */
async function tapAudio(stream: MediaStream): Promise<void> {
  try {
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const { ctx, mouth } = await ensureAudio();
    mouth.connect(ctx.createMediaStreamSource(new MediaStream(tracks)));
  } catch (err) {
    debug.error = `lip sync unavailable: ${(err as Error).message}`;
  }
}

// ---- video side: render the avatar into a canvas and capture it ----

let videoPromise: Promise<MediaStreamTrack> | undefined;

function startVideo(): Promise<MediaStreamTrack> {
  videoPromise ??= (async () => {
    const assets = await requestAssets();
    const canvas = document.createElement("canvas"); // never added to the page
    const stage = createStage(canvas, { pixelRatio: 1, background: BACKGROUND });
    stage.resize(WIDTH, HEIGHT);
    const avatar = await VrmAvatar.load(assets.vrm);
    stage.scene.add(avatar.scene);
    frameAvatar(stage.camera, avatar);
    const puppet = new Puppet(avatar, Date.now());

    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const mouth = currentMouth?.weights ?? {};
      puppet.update(dt, mouth);
      stage.renderer.render(stage.scene, stage.camera);
      debug.mouth = Math.max(0, ...Object.values(mouth));
    };
    // requestAnimationFrame stops in a hidden tab, which would freeze the avatar for everyone
    // else on the call. A slow timer keeps it moving, at whatever rate the browser allows.
    const frame = () => {
      tick();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setInterval(() => {
      if (performance.now() - last > 250) tick();
    }, 100);

    debug.avatarReady = true;
    return canvas.captureStream(FPS).getVideoTracks()[0]!;
  })().catch((err) => {
    videoPromise = undefined;
    debug.error = `avatar unavailable: ${(err as Error).message}`;
    throw err;
  });
  return videoPromise;
}

/** A fresh track per request, so the page stopping one does not stop the others. */
async function avatarTrack(): Promise<MediaStreamTrack> {
  const track = (await startVideo()).clone();
  Object.defineProperty(track, "label", { value: CAMERA_LABEL });
  debug.videoRequestsServed += 1;
  return track;
}

// ---- the replacements ----

const proto = MediaDevices.prototype;
const originalGetUserMedia = proto.getUserMedia;
const originalEnumerateDevices = proto.enumerateDevices;

function replace(name: "getUserMedia" | "enumerateDevices", fn: unknown): void {
  Object.defineProperty(fn, "name", { value: name });
  Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
}

replace("getUserMedia", async function getUserMedia(this: MediaDevices, constraints?: MediaStreamConstraints) {
  const wantVideo = !!constraints?.video;
  const wantAudio = !!constraints?.audio;

  if (!wantVideo) {
    const stream = await originalGetUserMedia.call(this, constraints);
    void tapAudio(stream);
    return stream;
  }

  let video: MediaStreamTrack;
  try {
    video = await avatarTrack();
  } catch {
    throw new DOMException("Could not start the avatar video source", "NotReadableError");
  }
  const tracks = [video];
  if (wantAudio) {
    // Ask the browser for the microphone only, never the camera.
    const audio = await originalGetUserMedia.call(this, { audio: constraints!.audio });
    void tapAudio(audio);
    tracks.push(...audio.getAudioTracks());
  }
  return new MediaStream(tracks);
});

replace("enumerateDevices", async function enumerateDevices(this: MediaDevices) {
  let others: MediaDeviceInfo[] = [];
  try {
    others = (await originalEnumerateDevices.call(this)).filter((d) => d.kind !== "videoinput");
  } catch {
    /* a blocked device list should not stop the avatar camera being offered */
  }
  const camera = {
    deviceId: CAMERA_ID,
    groupId: "vikaki",
    kind: "videoinput" as const,
    label: CAMERA_LABEL,
    toJSON() {
      return { deviceId: CAMERA_ID, groupId: "vikaki", kind: "videoinput", label: CAMERA_LABEL };
    },
  };
  return [camera as MediaDeviceInfo, ...others];
});

// A camera blocked by browser policy reports "denied", which makes many pages grey out the button.
class AlwaysGranted extends EventTarget {
  readonly name = "camera";
  readonly state = "granted";
  onchange: ((this: PermissionStatus, ev: Event) => unknown) | null = null;
}
const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
if (originalQuery) {
  Object.defineProperty(navigator.permissions, "query", {
    configurable: true,
    writable: true,
    value: function query(desc: PermissionDescriptor) {
      if ((desc as { name: string }).name === "camera") return Promise.resolve(new AlwaysGranted() as unknown as PermissionStatus);
      return originalQuery(desc);
    },
  });
}
