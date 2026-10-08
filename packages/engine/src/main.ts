import { Clock } from "three";
import { VrmAvatar } from "./vrm-avatar.ts";
import { AudioSession } from "./audio-session.ts";
import { mountDemoPanel } from "./demo-panel.ts";
import { SpeechPlayer, type LiveState } from "./speech-player.ts";
import { DriverConsole } from "./driver-console.ts";
import { mountSpeechDemo } from "./speech-demo.ts";
import { createStage, frameAvatar, Puppet } from "./stage.ts";
import type { VisemeWeights } from "./renderer.ts";

const params = new URLSearchParams(location.search);
const hud = document.getElementById("hud");
if (hud && params.get("hud") === "0") hud.hidden = true;
const say = (text: string) => {
  if (hud) hud.textContent = text;
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const { renderer, scene, camera, resize } = createStage(canvas);
new ResizeObserver(() => resize()).observe(canvas);

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
      /** What the avatar actually displayed for each mouth shape on the last frame (see `appliedVisemes`). */
      applied: VisemeWeights;
      /** Eyelid closure applied on the last frame, and how many blinks have started. */
      blink: number;
      blinks: number;
      setVisemes(w: VisemeWeights): void;
      /** Set when the page is connected to a hub (`?live=1`). `events` lists what it reported to the driver. */
      live?: { state: LiveState; soundBlocked: boolean; events: string[] };
      /** True if the avatar has eye bones; false means eye level is estimated. */
      eyeBones?: boolean;
    };
  }
}
const api: NonNullable<Window["__vikaki"]> = { ready: false, mic: "idle", visemes: {}, applied: {}, blink: 0, blinks: 0, setVisemes: () => {} };
window.__vikaki = api;

const baseUrl = import.meta.env.BASE_URL;
const avatarUrl = params.get("avatar") ?? `${baseUrl}avatars/cookieman.vrm`;
const demo = params.get("demo") === "1";
const seed = Number(params.get("seed") ?? Date.now());
const session = new AudioSession(`${baseUrl}profiles/default.bin`);

try {
  const avatar = await VrmAvatar.load(avatarUrl);
  scene.add(avatar.scene);
  api.eyeBones = frameAvatar(camera, avatar).eyeBones;

  let manual: VisemeWeights = {};
  api.avatar = avatar;
  api.setVisemes = (w) => {
    manual = w;
  };

  const puppet = new Puppet(avatar, seed);

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
    ? await mountDemoPanel({
        hold: (w) => (manual = w),
        blink: () => puppet.triggerBlink(),
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

  const speechDemo = params.get("demo") === "speech";
  if (params.get("live") === "1" || speechDemo) {
    const live = { state: "connecting" as LiveState, soundBlocked: true, events: [] as string[] };
    api.live = live;
    const url = new URL("/ws", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const player = new SpeechPlayer({
      url: url.href,
      session,
      sessionId: params.get("session") ?? undefined,
      onReport: (what) => live.events.push(what),
      onState: (state, soundBlocked) => {
        live.state = state;
        live.soundBlocked = soundBlocked;
        hud();
      },
    });
    const hud = () => say(live.state !== "connected" ? `vikaki · ${live.state}` : live.soundBlocked ? "vikaki · click the page to hear the avatar" : "vikaki · live");
    const unblock = () =>
      void session.resume().then(() => {
        live.soundBlocked = !session.running;
        hud();
      });
    window.addEventListener("pointerdown", unblock);
    window.addEventListener("keydown", unblock);
    player.start();

    if (speechDemo) {
      // This page is also the driver, so you can type text and watch the whole round trip.
      const driver = new DriverConsole(url.href, {
        state: (state, info) => ui.onState(state, info),
        message: (message) => ui.onMessage(message),
      });
      const ui = await mountSpeechDemo({ driver, unlockSound: unblock, soundBlocked: () => !session.running });
      driver.connect();
    }
  }

  api.ready = true;
  say(params.get("live") === "1" ? "vikaki · connecting" : "vikaki");

  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const mouth = Object.keys(manual).length > 0 ? manual : (session.lipsync?.weights ?? {});
    puppet.update(clock.getDelta(), mouth);
    api.visemes = puppet.visemes;
    api.applied = puppet.applied;
    api.blink = puppet.blink;
    api.blinks = puppet.blinks;
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
