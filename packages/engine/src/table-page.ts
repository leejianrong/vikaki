// The table page (`?seats=`): one scene with several avatars side by side, one per seat, so a table of LLM players can be watched on one
// screen (VIK-47, ADR-0017). It is a viewer that shows every line. Each line is played on the avatar of the seat it names, and that avatar
// gets the lip sync, the line's emotion and its turns' thinking pose; the others breathe, blink and sway. The hub speaks one line at a time,
// so one lip-sync node serves them all: whoever's line began last owns the mouth.
import { Box3, Clock, Vector3 } from "three";
import { AudioSession } from "./audio-session.ts";
import { FirstFrameTimer } from "./first-frame.ts";
import type { SeatPose, VisemeWeights } from "./renderer.ts";
import { SpeechPlayer, type LiveState } from "./speech-player.ts";
import { createStage, Puppet } from "./stage.ts";
import { EmotionSymbols } from "./symbols.ts";
import { TableOverlay } from "./table-overlay.ts";
import { TablePanel } from "./table-panel.ts";
import { TopBar } from "./table-topbar.ts";
import { StateHistory } from "./state-history.ts";
import { TransportBar } from "./transport-bar.ts";
import { cuesFor } from "./sfx-cues.ts";
import { Sfx } from "./sfx.ts";
import { TableProps } from "./table-props.ts";
import { buildTable, medianHeight, ovalSeats, seatLookYaw, type SeatSpot } from "./table3d.ts";
import { frameRow, layoutRow, lookYaw, parseSeats, seatFor } from "./table.ts";
import { VrmAvatar } from "./vrm-avatar.ts";
import { makeTransparent, parseEmbed } from "./embed.ts";
import { mountEmbedAudio } from "./embed-audio.ts";
import { DUET_GLANCE, DUET_TURN, duetFrame, type Rect } from "./duet.ts";
import { SpeakerLight } from "./duet-light.ts";

const params = new URLSearchParams(location.search);
const embedOpts = parseEmbed(params);
if (embedOpts.embed) makeTransparent(document);
const hud = document.getElementById("hud");
if (hud && !embedOpts.hud) hud.hidden = true;
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
api.audio = { get state() { return session.state; }, get played() { return session.played; }, get time() { return session.time; } };
const embedAudio = mountEmbedAudio({ session, embed: embedOpts, params }); // embed mode only: the "click for sound" button and the messages to the host (VIK-66)

/** What a seat showed since the last reset: the head's swing, the widest mouth, every mark over the head, and whether it was asked to think. */
/** The beats that are one seat's move, and how long the table keeps looking at the player who made it (ms). */
const ACTIONS = new Set(["fold", "check", "call", "raise"]);
const ACTOR_GAZE_MS = 2200;
const freshPeak = () => ({ yawMin: 0, yawMax: 0, mouth: 0, symbols: new Set<string>(), thought: false });

try {
  const res = await fetch(`${baseUrl}personas.json`);
  const known = res.ok ? ((await res.json()) as { name: string; avatarUrl: string; pose?: SeatPose }[]) : [];
  const seats = parseSeats(params.get("seats") ?? "", known.map((p) => p.name));
  const urls = seats.map((s, i) => known.find((p) => p.name === s.persona)?.avatarUrl ?? LOOKS[i % LOOKS.length]!);
  const avatars = await Promise.all(urls.map((u) => VrmAvatar.load(u)));

  // `?layout=duet` (VIK-68): two avatars facing each other round a clear band. It wins over `?view=table`.
  const duet = params.get("layout") === "duet";
  if (duet && seats.length !== 2) throw new Error(`layout=duet needs exactly two seats, got ${seats.length}`);
  // `?view=table` sits the avatars round a table (VIK-62, ADR-0019). An avatar that cannot sit keeps the whole page on the row.
  const wantTable = !duet && params.get("view") === "table";
  const spots: SeatSpot[] | undefined = wantTable && avatars.every((a) => a.canSeat) ? ovalSeats(avatars.length) : undefined;
  if (spots) {
    camera.fov = 38; // a long table needs a wider view than one avatar does
    camera.updateProjectionMatrix();
  }
  const rowNote = wantTable && !spots ? " · row view (an avatar cannot sit)" : "";
  let xs: number[];
  let tableY = 0;
  let props: TableProps | undefined;
  if (spots) {
    const poses = seats.map((s) => known.find((p) => p.name === s.persona)?.pose);
    avatars.forEach((a, i) => {
      a.seat(poses[i]);
      a.scene.position.set(spots[i]!.x, 0, spots[i]!.z);
      a.scene.rotation.y += spots[i]!.facing; // added to what the loader set (VRM 0.x is turned by pi to face the camera)
    });
    avatars.forEach((a) => a.scene.updateMatrixWorld(true));
    // Pose first, then set the table where the hands ended up (ADR-0019).
    const handsY = medianHeight(avatars.map((a) => a.handHeight()).filter((y): y is number => y !== undefined));
    tableY = handsY - 0.03;
    scene.add(buildTable(tableY));
    props = new TableProps(tableY, spots, seats.map((x) => x.seat));
    scene.add(props.group);
    avatars.forEach((a) => scene.add(a.scene));
    xs = spots.map((s) => s.x);
  } else {
    for (const a of avatars) a.lowerArms(); // side by side, arms out would cross the neighbours'

    // Lay them out in a row, each with room for its own body. Widths are read before anyone moves.
    // A duet is placed by `reframe`, which knows the canvas: the left one turns toward the right, the right one toward the left.
    xs = duet ? [0, 0] : layoutRow(avatars.map((a) => a.framing().width), GAP);
    if (duet) avatars.forEach((a, i) => (a.scene.rotation.y += i === 0 ? DUET_TURN : -DUET_TURN));
    avatars.forEach((a, i) => {
      a.scene.position.x = xs[i]!;
      scene.add(a.scene);
    });
  }

  const overlay = new TableOverlay(seats, document.body, embedOpts);
  if (spots) overlay.showCards = false; // they are on the table
  // The spectator panel (VIK-83): on by default in the 3D view, off when embedded; `?panel=1` or `?panel=0` decides.
  const wantPanel = params.has("panel") ? params.get("panel") === "1" : spots !== undefined && !embedOpts.embed;
  const panel = wantPanel ? new TablePanel(seats) : undefined;
  if (panel) overlay.withPanel = true;
  const topBar = panel ? new TopBar() : undefined;
  if (topBar) document.body.append(topBar.root);
  // Sound effects (VIK-122) go with the panel's controls: a page with no panel (an embed) leaves the sound to its host.
  const sfx = panel ? new Sfx(session) : undefined;
  if (panel && sfx) panel.addSoundControls(sfx);
  let lastState: Parameters<typeof cuesFor>[1] | undefined;
  const puppets = avatars.map((a, i) => new Puppet(a, seed + i * 101, params.get("still") !== "1"));
  const symbols = avatars.map((a) => {
    const { head, top } = a.framing();
    const s = new EmotionSymbols(new Vector3(head.x, (head.y + top) / 2, head.z + 0.05), (top - head.y) * 1.2);
    scene.add(s.group);
    return s;
  });
  /** Duet only: the speaker's light, and where the band is that nothing is drawn in (CSS pixels). */
  const lights = duet
    ? avatars.map((a) => {
        const { head, top } = a.framing();
        const l = new SpeakerLight(a.scene, new Vector3(head.x, head.y, head.z), (top - head.y) * 2.1);
        scene.add(l.group);
        return l;
      })
    : [];
  let band: Rect | undefined;
  let stacked = false;

  /** The camera at the row's eye line, far enough back for the whole row. Runs again when the canvas changes shape. */
  const bounds = avatars.map((a) => new Box3().setFromObject(a.scene));
  const frames = avatars.map((a) => a.framing());
  /** A duet keeps each avatar's head and this many head heights below it in view, and measures how wide the avatars are over what it sees. */
  const BUST = 1.2;
  const profiles = duet ? avatars.map((a) => a.widthProfile()) : [];
  // `?cam=x,y,z,tx,ty,tz` puts the camera there, looking at the target (a dev aid for judging a pose or a prop from the side or above).
  const cam = (params.get("cam") ?? "").split(",").map(Number);
  const debugCamera = cam.length === 6 && cam.every(Number.isFinite) ? cam : undefined;
  const reframe = () => {
    if (debugCamera) {
      camera.position.set(debugCamera[0]!, debugCamera[1]!, debugCamera[2]!);
      camera.lookAt(debugCamera[3]!, debugCamera[4]!, debugCamera[5]!);
      camera.updateMatrixWorld();
      return;
    }
    if (spots) {
      // A three-quarter view over the near rail: faces stay readable, the cards and chips show. Far enough back that the seats at the two ends fit.
      const reach = Math.max(...spots.map((s) => Math.abs(s.x))) + 0.38;
      const back = Math.max(3.0, reach / (Math.tan((camera.fov * Math.PI) / 360) * Math.max(camera.aspect, 0.1)));
      camera.position.set(0, tableY + 1.3, back);
      camera.lookAt(0, tableY + 0.18, -0.3);
      camera.updateMatrixWorld();
      overlay.place(
        frames.map((f) => ((new Vector3(f.head.x, f.head.y, f.head.z).project(camera).x + 1) / 2) * canvas.clientWidth),
        frames.map((f) => ((1 - new Vector3(f.head.x, f.top, f.head.z).project(camera).y) / 2) * canvas.clientHeight),
      );
      return;
    }
    if (duet) {
      const f = duetFrame({
        width: canvas.clientWidth || window.innerWidth,
        height: canvas.clientHeight || window.innerHeight,
        fov: camera.fov,
        top: Math.max(...frames.map((x) => x.top)),
        floor: Math.min(...bounds.map((b) => b.min.y)),
        bottom: Math.min(...frames.map((x) => x.head.y - BUST * (x.top - x.head.y))),
        widthIn: (lo, hi) => Math.max(...profiles.map((p) => p(lo, hi))),
      });
      band = f.band;
      stacked = f.stacked;
      // Stacked, the avatars are cut off at the band's top edge: the band is the host's, and nothing of ours is drawn in it.
      renderer.setScissorTest(f.stacked);
      if (f.stacked) renderer.setScissor(0, f.band.height, canvas.clientWidth, canvas.clientHeight - f.band.height);
      const z = frames[0]!.head.z;
      camera.position.set(0, f.y, z + f.distance);
      camera.lookAt(0, f.y, z);
      camera.updateMatrixWorld();
      // The avatars, their marks over the head and their halos all sit at the new x. (The marks and halos were built where the avatars started: x = 0.)
      [-f.x, f.x].forEach((x, i) => {
        avatars[i]!.scene.position.x = x;
        symbols[i]!.group.position.x = x;
        lights[i]!.group.position.x = x;
        xs[i] = x;
      });
      overlay.place(avatars.map((a) => ((new Vector3(a.scene.position.x, 0, z).project(camera).x + 1) / 2) * canvas.clientWidth));
      if (api.table?.duet) Object.assign(api.table.duet, { band: f.band, stacked: f.stacked });
      return;
    }
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
    camera.updateMatrixWorld();
    overlay.place(avatars.map((a) => ((new Vector3(a.scene.position.x, 0, z).project(camera).x + 1) / 2) * canvas.clientWidth));
  };
  reframe();
  new ResizeObserver(() => {
    resize();
    reframe();
  }).observe(canvas);

  api.table = {
    seats: seats.map((s, i) => ({ seat: s.seat, persona: s.persona, avatarUrl: urls[i]!, x: xs[i]!, visemes: {}, symbol: null, look: 0, yaw: 0, pitch: 0, roll: 0, peak: freshPeak(), kneeReach: spots ? avatars[i]!.kneeReach(Math.sin(spots[i]!.facing), Math.cos(spots[i]!.facing)) : undefined })),
    spoke: [],
    view: spots ? "table" : "row",
    props: props?.drawn,
    sfx,
    resetPeaks: () => {
      api.table!.seats.forEach((r) => (r.peak = freshPeak()));
      api.table!.spoke.length = 0;
    },
  };
  if (duet) api.table.duet = { band: band!, stacked, lit: [1, 1], halo: [0, 0], speaker: null };
  api.eyeBones = frames.every((f) => f.eyeBones);

  /** Whose line has the mouth: the seat whose line began last. The voice is one node, and the hub speaks one line at a time. */
  let speaking: number | undefined;
  /** Who has a line being heard now (cleared when it ends, unlike `speaking`, which the mouth keeps until the next line), and who is thinking. */
  let talker: number | undefined;
  let thinker: number | undefined;
  /** Every seat but the one in focus looks at it: the speaker, else whoever is thinking. The one in focus looks ahead. */
  let focused: number | undefined;
  /** The seat that has just acted, looked at by the others while its move sits on screen (VIK-134); a line or the next turn takes the gaze over. */
  let actor: number | undefined;
  let actorTimer: ReturnType<typeof setTimeout> | undefined;
  const refocus = () => {
    const focus = talker ?? thinker ?? actor;
    focused = focus;
    if (duet) {
      puppets.forEach((p, j) => p.reaction.look(focus === undefined || focus === j ? 0 : (j === 0 ? 1 : -1) * DUET_GLANCE));
      lights.forEach((l, j) => l.set(focus === undefined ? undefined : focus === j));
      return;
    }
    puppets.forEach((p, j) => p.reaction.look(focus === undefined || focus === j ? 0 : spots ? seatLookYaw(spots[j]!, spots[focus]!) : lookYaw(xs[j]!, xs[focus]!)));
  };
  const live = { state: "connecting" as LiveState, soundBlocked: true, events: [] as string[] };
  api.live = live;
  const firstFrame = new FirstFrameTimer();
  const url = new URL("/ws", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const who = ` · table of ${seats.length}${rowNote}`;
  const showHud = () => say(live.state !== "connected" ? `vikaki${who} · ${live.state}` : live.soundBlocked ? `vikaki${who} · click the page to hear the avatars` : `vikaki${who} · live`);
  // Playback (VIK-135): every state is kept so a spectator can step back; stepping back snaps, with no motion and no sound.
  const history = new StateHistory<Parameters<typeof cuesFor>[1]>();
  const transport = { available: false, paused: false };
  const show = (state: Parameters<typeof cuesFor>[1], o: { snap?: boolean; silent?: boolean } = {}) => {
    const moved = !o.silent && state.event && ACTIONS.has(state.event.kind) && state.event.seat_id !== undefined ? seats.findIndex((s) => s.seat === state.event!.seat_id) : -1;
    if (moved >= 0) {
      actor = moved;
      clearTimeout(actorTimer);
      actorTimer = setTimeout(() => ((actor = undefined), refocus()), ACTOR_GAZE_MS);
      refocus();
    }
    overlay.setState(state);
    panel?.setState(state);
    topBar?.setState(state);
    props?.setState(state, o.snap);
    if (sfx && !o.silent && JSON.stringify(state) !== JSON.stringify(lastState)) sfx.play(cuesFor(lastState, state, seats.map((x) => x.seat)));
    lastState = state;
  };
  let lastKey = "";
  let refreshBar = () => {};
  const player = new SpeechPlayer({
    url: url.href,
    timer: firstFrame,
    session,
    sessionId: params.get("session") ?? undefined,
    onEmotion: (emotion, intensity, phase, line) => {
      const i = seatFor(seats, line);
      if (i === undefined) return;
      if (phase === "start") {
        speaking = talker = i;
        puppets[i]!.emotion.set(emotion, intensity);
      } else {
        if (talker === i) talker = undefined;
        puppets[i]!.emotion.release(0.7);
      }
      refocus();
    },
    onReact: (r) => {
      const i = seatFor(seats, { seat: r.seat, persona: r.persona });
      if (i === undefined || talker === i || puppets[i]!.emotion.thinking) return; // its own line's feeling and its turn's thinking pose win
      if (r.emotion !== undefined) puppets[i]!.emotion.react(r.emotion, r.intensity, r.seconds);
      if (r.gesture) puppets[i]!.reaction.play(r.gesture);
    },
    onTurn: (thinking, seat, persona) => {
      if (seat === "") {
        thinker = talker = undefined;
        puppets.forEach((p) => p.emotion.think(false)); // the connection was lost: nobody is waiting on a move
        return refocus();
      }
      const i = seatFor(seats, { seat, persona });
      if (i === undefined) return;
      puppets[i]!.emotion.think(thinking);
      if (thinking) overlay.setThought(seats[i]!.seat, false); // a new turn: the last thought is stale
      if (thinking) api.table!.seats[i]!.peak.thought = true; // a beat shorter than a frame gap is never drawn on a slow page (VIK-77)
      if (thinking) (actor = undefined), clearTimeout(actorTimer);
      if (thinking) thinker = i;
      else if (thinker === i) thinker = undefined;
      refocus();
    },
    onThought: (t) => {
      const i = seatFor(seats, { seat: t.seat, persona: t.persona });
      if (i === undefined) return;
      overlay.setThought(seats[i]!.seat, true);
      panel?.addThought(seats[i]!.seat, t.text);
    },
    onTableState: (state) => {
      const key = JSON.stringify(state);
      if (key === lastKey) return; // the same state again changes nothing, and is not a step
      lastKey = key;
      panel?.addActivity(state);
      const shown = history.push(state);
      if (shown) show(shown);
      refreshBar();
    },
    onTransportState: (p) => {
      transport.available = true;
      transport.paused = p;
      refreshBar();
    },
    onText: (line) => {
      if (line.thought) {
        // A monologue spoken aloud (VIK-121): a thought bubble and the Thoughts list, never the chat.
        if (line.text !== undefined) {
          overlay.addSpokenThought(line.seat, line.text);
          panel?.addThought(line.seat, line.text);
        }
        return;
      }
      overlay.addText(line);
      panel?.addText(line);
    },
    onLifecycle: (e) => embedAudio?.bridge.send(e), // embed mode: tell the framing page (ADR-0020), if it named itself
    onReport: (what) => live.events.push(what),
    onState: (state, soundBlocked) => {
      live.state = state;
      live.soundBlocked = soundBlocked;
      showHud();
    },
  });
  const bar = panel
    ? new TransportBar({
        back: () => {
          if (!transport.paused) (transport.paused = true), player.sendTransport("pause"); // looking back holds the game still
          const s = history.back();
          if (s) show(s, { snap: true, silent: true });
          refreshBar();
        },
        toggle: () => {
          if (transport.paused) {
            const s = history.reviewing ? history.live() : undefined;
            if (s) show(s, { snap: true, silent: true });
            transport.paused = false;
            player.sendTransport("play");
          } else {
            transport.paused = true;
            player.sendTransport("pause");
          }
          refreshBar();
        },
        forward: () => {
          if (history.reviewing) {
            const s = history.forward();
            if (s) show(s);
          } else if (transport.paused) player.sendTransport("step");
          refreshBar();
        },
      })
    : undefined;
  if (bar) overlay.mount(bar.root);
  refreshBar = () => {
    bar?.update({ available: transport.available, paused: transport.paused, reviewing: history.reviewing, position: history.position, length: history.length });
    api.table!.transport = { available: transport.available, paused: transport.paused, reviewing: history.reviewing, position: history.position, length: history.length };
  };
  const unblock = () =>
    void session.resume().then(() => {
      live.soundBlocked = !session.running;
      showHud();
    });
  window.addEventListener("pointerdown", unblock);
  window.addEventListener("keydown", unblock);
  if (embedAudio) embedAudio.onHumanUtterance = (speech) => void player.sendHumanUtterance(speech); // a human's speech from the framing page, for the seat's driver (VIK-69)
  player.start();

  api.ready = true;
  say(`vikaki${who} · connecting`);

  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const voice: VisemeWeights = session.lipsync?.weights ?? {};
    props?.update(dt); // chips thrown in, cards pushed away (VIK-113)
    puppets.forEach((p, i) => {
      p.update(dt, i === speaking ? voice : {});
      symbols[i]!.update(dt, p.emotion.pose);
      const row = api.table!.seats[i]!;
      row.visemes = p.visemes;
      row.symbol = p.emotion.pose.symbol ?? null;
      row.look = p.reaction.looking;
      row.yaw = p.head.yaw;
      row.pitch = p.head.pitch;
      row.roll = p.head.roll;
      // Peaks over every frame drawn, so a short pose cannot fall between two polls on a slow page (VIK-75).
      const open = Math.max(0, ...Object.values(p.visemes));
      row.peak.yawMin = Math.min(row.peak.yawMin, row.yaw);
      row.peak.yawMax = Math.max(row.peak.yawMax, row.yaw);
      row.peak.mouth = Math.max(row.peak.mouth, open);
      if (row.symbol) row.peak.symbols.add(row.symbol);
    });
    if (duet) {
      lights.forEach((l) => l.update(dt));
      Object.assign(api.table!.duet!, { lit: lights.map((l) => l.level), halo: lights.map((l) => l.halo), speaker: focused === undefined ? null : seats[focused]!.seat });
    }
    const mouths = api.table!.seats.map((r) => Math.max(0, ...Object.values(r.visemes)));
    const loudest = mouths.indexOf(Math.max(...mouths));
    const spoke = api.table!.spoke;
    if (mouths[loudest]! > 0.3 && spoke[spoke.length - 1] !== loudest) spoke.push(loudest);
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
