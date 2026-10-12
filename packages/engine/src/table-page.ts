// The table page (`?seats=`): one scene with several avatars side by side, one per seat, so a table of LLM players can be watched on one
// screen (KAN-2060, ADR-0017). It is a viewer that shows every line. Each line is played on the avatar of the seat it names, and that avatar
// gets the lip sync, the line's emotion and its turns' thinking pose; the others breathe, blink and sway. The hub speaks one line at a time,
// so one lip-sync node serves them all: whoever's line began last owns the mouth.
import { Box3, Clock, Vector3 } from "three";
import { AudioSession } from "./audio-session.ts";
import { FirstFrameTimer } from "./first-frame.ts";
import type { VisemeWeights } from "./renderer.ts";
import { SpeechPlayer, type LiveState } from "./speech-player.ts";
import { createStage, Puppet } from "./stage.ts";
import { EmotionSymbols } from "./symbols.ts";
import { frameRow, layoutRow, parseSeats, seatFor } from "./table.ts";
import { VrmAvatar } from "./vrm-avatar.ts";

const params = new URLSearchParams(location.search);
const hud = document.getElementById("hud");
if (hud && params.get("hud") === "0") hud.hidden = true;
const say = (text: string) => {
  if (hud) hud.textContent = text;
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const { renderer, scene, camera, resize } = createStage(canvas);

const api: NonNullable<Window["__vikaki"]> = { ready: false, mic: "idle", visemes: {}, applied: {}, blink: 0, blinks: 0, setVisemes: () => {}, setEmotion: () => {}, setThinking: () => {} };
window.__vikaki = api;

const bg = params.get("bg");
if (bg && /^[0-9a-f]{6}$/i.test(bg)) document.body.style.background = `#${bg}`;

const baseUrl = import.meta.env.BASE_URL;
/** Avatars for seats that name no persona, alternated so neighbours differ. */
const LOOKS = [`${baseUrl}avatars/cookieman.vrm`, `${baseUrl}avatars/snowy.vrm`];
const GAP = 0.15; // metres between neighbours
const seed = Number(params.get("seed") ?? Date.now());
const session = new AudioSession(`${baseUrl}profiles/default.bin`);

try {
  const res = await fetch(`${baseUrl}personas.json`);
  const known = res.ok ? ((await res.json()) as { name: string; avatarUrl: string }[]) : [];
  const seats = parseSeats(params.get("seats") ?? "", known.map((p) => p.name));
  const urls = seats.map((s, i) => known.find((p) => p.name === s.persona)?.avatarUrl ?? LOOKS[i % LOOKS.length]!);
  const avatars = await Promise.all(urls.map((u) => VrmAvatar.load(u)));

  for (const a of avatars) a.lowerArms(); // side by side, arms out would cross the neighbours'

  // Lay them out in a row, each with room for its own body. Widths are read before anyone moves.
  const xs = layoutRow(avatars.map((a) => a.framing().width), GAP);
  avatars.forEach((a, i) => {
    a.scene.position.x = xs[i]!;
    scene.add(a.scene);
  });

  const puppets = avatars.map((a, i) => new Puppet(a, seed + i * 101, params.get("still") !== "1"));
  const symbols = avatars.map((a) => {
    const { head, top } = a.framing();
    const s = new EmotionSymbols(new Vector3(head.x, (head.y + top) / 2, head.z + 0.05), (top - head.y) * 1.2);
    scene.add(s.group);
    return s;
  });

  /** The camera at the row's eye line, far enough back for the whole row. Runs again when the canvas changes shape. */
  const bounds = avatars.map((a) => new Box3().setFromObject(a.scene));
  const frames = avatars.map((a) => a.framing());
  const reframe = () => {
    const left = Math.min(...bounds.map((b) => b.min.x));
    const right = Math.max(...bounds.map((b) => b.max.x));
    const centre = (left + right) / 2;
    const f = frameRow({
      eyeY: frames.reduce((s, x) => s + x.eyeLevel, 0) / frames.length,
      headY: Math.min(...frames.map((x) => x.head.y)),
      topY: Math.max(...frames.map((x) => x.top)),
      fov: camera.fov,
      spanWidth: right - left,
      aspect: camera.aspect,
    });
    const z = frames[0]!.head.z;
    camera.position.set(centre, f.y, z + f.distance);
    // Looking a few degrees down puts the heads about 40% from the top instead of in the middle, so the bodies show and the sky does not.
    const visibleHeight = 2 * f.distance * Math.tan((camera.fov * Math.PI) / 360);
    camera.lookAt(centre, f.y - 0.1 * visibleHeight, z);
  };
  reframe();
  new ResizeObserver(() => {
    resize();
    reframe();
  }).observe(canvas);

  api.table = {
    seats: seats.map((s, i) => ({ seat: s.seat, persona: s.persona, avatarUrl: urls[i]!, x: xs[i]!, visemes: {}, symbol: null })),
  };
  api.eyeBones = frames.every((f) => f.eyeBones);

  /** Whose line has the mouth: the seat whose line began last. The voice is one node, and the hub speaks one line at a time. */
  let speaking: number | undefined;
  const live = { state: "connecting" as LiveState, soundBlocked: true, events: [] as string[] };
  api.live = live;
  const firstFrame = new FirstFrameTimer();
  const url = new URL("/ws", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const who = ` · table of ${seats.length}`;
  const showHud = () => say(live.state !== "connected" ? `vikaki${who} · ${live.state}` : live.soundBlocked ? `vikaki${who} · click the page to hear the avatars` : `vikaki${who} · live`);
  const player = new SpeechPlayer({
    url: url.href,
    timer: firstFrame,
    session,
    sessionId: params.get("session") ?? undefined,
    onEmotion: (emotion, intensity, phase, line) => {
      const i = seatFor(seats, line);
      if (i === undefined) return;
      if (phase === "start") {
        speaking = i;
        puppets[i]!.emotion.set(emotion, intensity);
      } else {
        puppets[i]!.emotion.release(0.7);
      }
    },
    onTurn: (thinking, seat, persona) => {
      if (seat === "") return void puppets.forEach((p) => p.emotion.think(false)); // the connection was lost: nobody is waiting on a move
      const i = seatFor(seats, { seat, persona });
      if (i !== undefined) puppets[i]!.emotion.think(thinking);
    },
    onReport: (what) => live.events.push(what),
    onState: (state, soundBlocked) => {
      live.state = state;
      live.soundBlocked = soundBlocked;
      showHud();
    },
  });
  const unblock = () =>
    void session.resume().then(() => {
      live.soundBlocked = !session.running;
      showHud();
    });
  window.addEventListener("pointerdown", unblock);
  window.addEventListener("keydown", unblock);
  player.start();

  api.ready = true;
  say(`vikaki${who} · connecting`);

  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const voice: VisemeWeights = session.lipsync?.weights ?? {};
    puppets.forEach((p, i) => {
      p.update(dt, i === speaking ? voice : {});
      symbols[i]!.update(dt, p.emotion.pose);
      const row = api.table!.seats[i]!;
      row.visemes = p.visemes;
      row.symbol = p.emotion.pose.symbol ?? null;
    });
    const lead = puppets[speaking ?? 0]!;
    api.visemes = lead.visemes;
    api.applied = lead.applied;
    api.blink = lead.blink;
    api.blinks = lead.blinks;
    firstFrame.frame(performance.now(), speaking === undefined ? 0 : Object.values(voice).reduce((a, w) => a + (w ?? 0), 0));
    renderer.render(scene, camera);
  });
} catch (err) {
  console.error(err);
  say(`error: ${(err as Error).message}`);
}
