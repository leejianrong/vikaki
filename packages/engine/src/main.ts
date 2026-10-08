import { Box3, Clock, Vector3 } from "three";
import { VrmAvatar } from "./vrm-avatar.ts";
import { AudioSession } from "./audio-session.ts";
import { mountDemoPanel } from "./demo-panel.ts";
import { SpeechPlayer, type LiveState } from "./speech-player.ts";
import { DriverConsole } from "./driver-console.ts";
import { mountSpeechDemo } from "./speech-demo.ts";
import { createStage, frameAvatar, Puppet } from "./stage.ts";
import { EmotionSymbols } from "./symbols.ts";
import { poseFor, type EmotionPose } from "./emotion.ts";
import { FirstFrameTimer } from "./first-frame.ts";
import { TimelineRecorder } from "./timeline.ts";
import type { TimelineUi } from "./timeline-ui.ts";
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
      /** What the page recorded on one clock: frames, events, speech pieces and audio. Only with the speech demo or `?timeline=1`. */
      timeline?: TimelineRecorder;
      /** The timeline dock (speech demo): which view is showing, switching it, and exporting what it shows. */
      timelineUi?: TimelineUi;
      /** Show an emotion now (what the driver's `emotion` and `intensity` do). Unknown names are neutral. */
      setEmotion(emotion: string | undefined, intensity?: number): void;
      /** Start or end the thinking pose, as `turn_started` and `turn_ended` do. */
      setThinking(on: boolean): void;
      /** What the preset for `emotion` at `intensity` says. For tests to compare against `emotionPose`. */
      presetPose?: (emotion: string, intensity: number) => EmotionPose;
      /** The emotion on show after the last frame, and the symbol drawn for it. */
      emotionPose?: EmotionPose;
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
const api: NonNullable<Window["__vikaki"]> = { ready: false, mic: "idle", visemes: {}, applied: {}, blink: 0, blinks: 0, setVisemes: () => {}, setEmotion: () => {}, setThinking: () => {} };
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
  const box = new Box3().setFromObject(avatar.scene);
  const head = avatar.headPosition();
  const symbols = new EmotionSymbols(new Vector3(head.x, (head.y + box.max.y) / 2, head.z + 0.05), (box.max.y - head.y) * 1.2);
  scene.add(symbols.group);
  api.setEmotion = (e, i) => puppet.emotion.set(e, i);
  api.setThinking = (on) => puppet.emotion.think(on);
  api.presetPose = poseFor;
  if (params.has("emotion")) puppet.emotion.set(params.get("emotion")!, params.has("intensity") ? Number(params.get("intensity")) : 1);

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
  const firstFrame = new FirstFrameTimer();
  const timeline = speechDemo || params.get("timeline") === "1" ? (api.timeline = new TimelineRecorder()) : undefined;
  if (params.get("live") === "1" || speechDemo) {
    const live = { state: "connecting" as LiveState, soundBlocked: true, events: [] as string[] };
    api.live = live;
    const url = new URL("/ws", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const player = new SpeechPlayer({
      url: url.href,
      timer: firstFrame,
      // The face follows the line: its emotion while it is heard, then a moment's lingering before relaxing.
      onTurn: (thinking) => puppet.emotion.think(thinking),
      onEmotion: (e, i, phase) => (phase === "start" ? puppet.emotion.set(e, i) : puppet.emotion.release(0.7)),
      session,
      sessionId: params.get("session") ?? undefined,
      onReport: (what) => {
        live.events.push(what);
        const [kind, ...id] = what.split(":");
        timeline?.event(kind!, id.join(":"));
      },
      onScheduled: (slice) => timeline?.scheduled(slice),
      onSentence: (s) => timeline?.sentence(s.utteranceId, s.index, s.text, s.samples, s.sampleRate),
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
      const ui = await mountSpeechDemo({ driver, timeline, unlockSound: unblock, soundBlocked: () => !session.running });
      if (timeline) api.timelineUi = (await import("./timeline-ui.ts")).mountTimeline(timeline);
      driver.connect();
    }
  }

  api.ready = true;
  say(params.get("live") === "1" ? "vikaki · connecting" : "vikaki");

  const clock = new Clock();
  let lastBlinks = 0;
  renderer.setAnimationLoop(() => {
    const mouth = Object.keys(manual).length > 0 ? manual : (session.lipsync?.weights ?? {});
    const dt = clock.getDelta();
    puppet.update(dt, mouth);
    symbols.update(dt, puppet.emotion.pose);
    api.emotionPose = puppet.emotion.pose;
    api.visemes = puppet.visemes;
    api.applied = puppet.applied;
    firstFrame.frame(performance.now(), Object.values(mouth).reduce((a, w) => a + (w ?? 0), 0)); // what lip sync asked for, not the resting smile
    if (timeline) {
      timeline.frame(mouth, puppet.applied, session.lipsync?.volume ?? 0, puppet.blink);
      if (puppet.blinks !== lastBlinks) timeline.event("blink");
      lastBlinks = puppet.blinks;
    }
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
