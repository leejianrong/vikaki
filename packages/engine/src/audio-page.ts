import { AudioSession } from "./audio-session.ts";
import type { MouthDriver } from "./mouth.ts";
import { SpeechPlayer, type LiveState } from "./speech-player.ts";
import { FirstFrameTimer } from "./first-frame.ts";

const params = new URLSearchParams(location.search);
const persona = params.get("persona") ?? undefined;
const canvas = document.getElementById("stage");
if (canvas) canvas.remove(); // nothing is drawn, and no WebGL context is ever created
const hud = document.getElementById("hud");
if (hud && params.get("hud") === "0") hud.hidden = true;
const say = (text: string) => {
  if (hud) hud.textContent = text;
};

/** No mouth to move: playback still needs something to connect its audio to. */
const noMouth: MouthDriver = { weights: {}, volume: 0, connect: () => {}, mute: () => {}, unmute: () => {} };
const session = new AudioSession("", { createMouth: async () => ({ kind: "amplitude", driver: noMouth }) });

const live = { state: "connecting" as LiveState, soundBlocked: true, events: [] as string[] };
const api: NonNullable<Window["__vikaki"]> = {
  ready: false,
  mic: "idle",
  visemes: {},
  applied: {},
  blink: 0,
  blinks: 0,
  setVisemes: () => {},
  setEmotion: () => {},
  setThinking: () => {},
  persona,
  audioOnly: true,
  live,
};
window.__vikaki = api;

const who = persona ? ` · ${persona}` : "";
const hudText = () => say(live.state !== "connected" ? `vikaki${who} · audio only · ${live.state}` : live.soundBlocked ? `vikaki${who} · audio only · click the page to hear it` : `vikaki${who} · audio only · live`);
const url = new URL("/ws", location.href);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
const player = new SpeechPlayer({
  url: url.href,
  persona,
  session,
  timer: new FirstFrameTimer(), // there are no frames, so a line's timing has audio only
  sessionId: params.get("session") ?? undefined,
  onReport: (what) => live.events.push(what),
  onState: (state, soundBlocked) => {
    live.state = state;
    live.soundBlocked = soundBlocked;
    hudText();
  },
});
const unblock = () =>
  void session.resume().then(() => {
    live.soundBlocked = !session.running;
    hudText();
  });
window.addEventListener("pointerdown", unblock);
window.addEventListener("keydown", unblock);
player.start();
api.ready = true;
hudText();
