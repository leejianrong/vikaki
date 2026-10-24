// The table page (`?seats=`): one scene with several avatars side by side, one per seat, so a table of LLM players can be watched on one
// screen (VIK-47, ADR-0017). It is a viewer that shows every line. Each line is played on the avatar of the seat it names, and that avatar
// gets the lip sync, the line's emotion and its turns' thinking pose; the others breathe, blink and sway. The hub speaks one line at a time,
// so one lip-sync node serves them all: whoever's line began last owns the mouth.
import { Box3, Clock, PerspectiveCamera, Vector3 } from "three";
import { AudioSession } from "./audio-session.ts";
import { FirstFrameTimer } from "./first-frame.ts";
import type { SeatPose, VisemeWeights } from "./renderer.ts";
import { SpeechPlayer, type LiveState } from "./speech-player.ts";
import { createStage, Puppet } from "./stage.ts";
import { EmotionSymbols } from "./symbols.ts";
import { TableOverlay } from "./table-overlay.ts";
import { CameraRig, parseShot, shotFor, type Shot, type ShotName } from "./cameras.ts";
import { parseDeck, setDeck } from "./card-art.ts";
import { Director, type Cue } from "./director.ts";
import { gridInterval, gridLayout, type Tile } from "./pov-grid.ts";
import { actFor, type Act } from "./arm-act.ts";
import { TablePanel } from "./table-panel.ts";
import { TopBar } from "./table-topbar.ts";
import { StateHistory } from "./state-history.ts";
import { TransportBar } from "./transport-bar.ts";
import { cuesFor } from "./sfx-cues.ts";
import { Sfx } from "./sfx.ts";
import { TableProps } from "./table-props.ts";
import { buildTable, medianHeight, ovalSeats, seatLookYaw, type SeatSpot } from "./table3d.ts";
import { buildDen, type Den } from "./den.ts";
import { Glancer, type Glance } from "./look-around.ts";
import { FidgetScheduler, type FidgetKind } from "./fidgets.ts";
import { PEEK_HEAD, peekPhase } from "./peek.ts";
import { restackReach } from "./restack.ts";
import { extraPose, isExtra, type ExtraKind } from "./extras.ts";
import { mulberry32 } from "./behaviour.ts";
import { frameRow, layoutRow, lookYaw, parseSeats, seatFor } from "./table.ts";
import { VrmAvatar } from "./vrm-avatar.ts";
import { makeTransparent, parseEmbed } from "./embed.ts";
import { mountEmbedAudio } from "./embed-audio.ts";
import { DUET_GLANCE, DUET_TURN, duetFrame, type Rect } from "./duet.ts";
import { SpeakerLight } from "./duet-light.ts";

const params = new URLSearchParams(location.search);
const embedOpts = parseEmbed(params);
setDeck(parseDeck(params.get("cards"))); // `?cards=classic` (VIK-115): the cards drawn as in a real deck; the default stays the clean look
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
api.audio = { get state() { return session.state; }, get played() { return session.played; }, get time() { return session.time; }, get voice() { return { ...session.voice, gain: session.busGain }; } };
const embedAudio = mountEmbedAudio({ session, embed: embedOpts, params }); // embed mode only: the "click for sound" button and the messages to the host (VIK-66)

/** What a seat showed since the last reset: the head's swing, the widest mouth, every mark over the head, and whether it was asked to think. */
/** The beats that are one seat's move, and how long the table keeps looking at the player who made it (ms). */
const ACTIONS = new Set(["fold", "check", "call", "raise"]);
const ACTOR_GAZE_MS = 2200;
const freshPeak = () => ({ yawMin: 0, yawMax: 0, mouth: 0, symbols: new Set<string>(), thought: false, glances: new Set<string>(), fidgets: new Set<string>() });

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
  let den: Den | undefined;
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
    if (params.get("den") !== "off") {
      den = buildDen(tableY); // the living room round the table (VIK-101); `?den=off` leaves the bare table
      scene.add(den.group);
    }
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
  const VOICE_KEY = "vikaki.voice";
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_KEY) ?? "{}") as { volume?: number; muted?: boolean };
    session.setVoice({ ...(typeof saved.volume === "number" ? { volume: saved.volume } : {}), ...(typeof saved.muted === "boolean" ? { muted: saved.muted } : {}) });
  } catch {
    /* not remembered */
  }
  /** The table voices' level (VIK-109): for talking over them. Remembered, like the effects'. */
  const voiceLevel = {
    get volume() { return session.voice.volume; },
    get muted() { return session.voice.muted; },
    set(o: { volume?: number; muted?: boolean }) {
      session.setVoice(o);
      try {
        localStorage.setItem(VOICE_KEY, JSON.stringify({ volume: session.voice.volume, muted: session.voice.muted }));
      } catch {
        /* not remembered */
      }
    },
  };
  if (panel) panel.addVoiceControls(voiceLevel);
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
  /** The table's cameras (VIK-95): the shot asked for (`?camera=wide|overhead|seat:N`), and the rig that glides between shots. */
  let shotName: ShotName = (spots ? parseShot(params.get("camera"), seats.length) : undefined) ?? "wide";
  const eyesNow = () => frames.map((f, i) => ({ x: f.head.x + Math.sin(spots![i]!.facing) * 0.06, y: f.eyeLevel, z: f.head.z + Math.cos(spots![i]!.facing) * 0.06 }));
  const shotNow = (name: ShotName): Shot => shotFor(name, { tableY, spots: spots!, heads: frames.map((f) => f.head), tops: frames.map((f) => f.top), eyes: eyesNow(), aspect: Math.max(camera.aspect, 0.1), fov: 38 });
  const rig = spots ? new CameraRig(shotNow(shotName)) : undefined;
  overlay.setCloseUp(shotName.startsWith("seat:"));
  if (shotName.startsWith("pov:")) overlay.setPov(seats[Number(shotName.slice(4))]!.seat);
  /** The POV grid (VIK-100): drawn tile by tile over the canvas, a few times a second, since it costs a whole picture for each player. */
  const tileCam = new PerspectiveCamera(38, 1, 0.1, 50);
  let gridOn = shotName === "grid";
  let gridFrame = 0;
  let gridDirty = true;
  let frameMs = 16;
  let gridTiles: Tile[] = [];
  const tileShots: { seat: string; position: number[]; fov: number }[] = [];
  const drawGrid = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (gridDirty) {
      const top = topBar && !topBar.root.hidden ? topBar.root.offsetHeight + 4 : 0; // below the bar across the top of the stage
      gridTiles = gridLayout(seats.length, w, h - top).map((t) => ({ ...t, y: t.y + top }));
      overlay.setGrid(gridTiles);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.clear(); // the gaps between the tiles
      gridDirty = false;
    }
    renderer.setScissorTest(true);
    tileShots.length = 0;
    gridTiles.forEach((t, i) => {
      const shot = shotFor(`pov:${i}`, { tableY, spots: spots!, heads: frames.map((f) => f.head), tops: frames.map((f) => f.top), eyes: eyesNow(), aspect: t.width / t.height, fov: 38 });
      tileCam.aspect = t.width / t.height;
      tileCam.fov = shot.fov;
      tileCam.updateProjectionMatrix();
      tileCam.position.set(shot.position.x, shot.position.y, shot.position.z);
      tileCam.lookAt(shot.target.x, shot.target.y, shot.target.z);
      tileCam.updateMatrixWorld();
      hideHead(i); // each tile is that player's own view, without their head
      const y = h - t.y - t.height;
      renderer.setViewport(t.x, y, t.width, t.height);
      renderer.setScissor(t.x, y, t.width, t.height);
      renderer.render(scene, tileCam);
      tileShots.push({ seat: seats[i]!.seat, position: [shot.position.x, shot.position.y, shot.position.z], fov: shot.fov });
    });
    hideHead(undefined);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  };
  /** The head of the player whose eyes the camera is at is hidden (VIK-99), so it does not fill the picture; it goes late in the glide so no head vanishes in view. */
  let headHidden: number | undefined;
  const hideHead = (i: number | undefined) => {
    if (headHidden === i) return;
    if (headHidden !== undefined) avatars[headHidden]!.setHeadHidden?.(false);
    headHidden = i;
    if (i !== undefined) avatars[i]!.setHeadHidden?.(true);
  };
  const direct = (cue: Cue) => {
    const shot = director.cue(cue, now());
    if (shot) cutTo(shot);
  };
  const placeOverlay = () =>
    overlay.place(
      frames.map((f) => ((new Vector3(f.head.x, f.head.y, f.head.z).project(camera).x + 1) / 2) * canvas.clientWidth),
      frames.map((f) => ((1 - new Vector3(f.head.x, f.top, f.head.z).project(camera).y) / 2) * canvas.clientHeight),
    );
  const applyShot = (s: Shot) => {
    camera.position.set(s.position.x, s.position.y, s.position.z);
    camera.lookAt(s.target.x, s.target.y, s.target.z);
    if (camera.fov !== s.fov) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    placeOverlay();
  };
  /** The auto-director (VIK-96): on unless `?director=off`; a person's own choice of shot quiets it for a while. */
  const director = new Director(undefined, params.get("showdown") === "grid" ? "grid" : "wide"); // `?showdown=grid` cuts to the POV grid at the showdown
  director.enabled = params.get("director") !== "off";
  const now = () => performance.now() / 1000;
  /** Cut to another shot with a glide. `byHand` is a person's choice (a button or a key), which the director then leaves alone for a while. */
  const cutTo = (name: ShotName, byHand = false) => {
    if (!rig) return;
    if (byHand) director.override(name, now());
    if (name === shotName) return;
    shotName = name;
    den?.setPendantVisible(name !== "overhead"); // the overhead camera sits right above the lamp
    rig.moveTo(shotNow(name));
    overlay.setCloseUp(name.startsWith("seat:"));
    gridOn = name === "grid";
    gridDirty = true;
    if (!gridOn) overlay.setGrid(undefined);
    const pov = name.startsWith("pov:") ? Number(name.slice(4)) : undefined;
    overlay.setPov(pov !== undefined ? seats[pov]!.seat : undefined);
    if (pov === undefined) hideHead(undefined); // leaving a POV: the head is back at once, before the camera moves away
    panel?.setCameraShot(name);
  };
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
      // The table's cameras (VIK-95): the shot being shown, glided to, and re-framed for the canvas's new shape.
      rig!.retarget(shotNow(shotName));
      applyShot(rig!.shot);
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
    gridDirty = true; // the tiles of the POV grid follow the canvas (VIK-100)
    resize();
    reframe();
  }).observe(canvas);

  api.table = {
    den: den && { triangles: den.triangles, targets: den.lookTargets.map((t) => t.name) },
    seats: seats.map((s, i) => ({ seat: s.seat, persona: s.persona, avatarUrl: urls[i]!, x: xs[i]!, visemes: {}, symbol: null, look: 0, yaw: 0, pitch: 0, roll: 0, peak: freshPeak(), kneeReach: spots ? avatars[i]!.kneeReach(Math.sin(spots[i]!.facing), Math.cos(spots[i]!.facing)) : undefined })),
    spoke: [],
    view: spots ? "table" : "row",
    props: props?.drawn,
    sfx,
    acted: [],
    listen: { mode: "all" },
    holdExtra: (i, kind, phase) => void (heldExtra[i] = kind ? { kind: kind as ExtraKind, phase } : undefined),
    holdRestack: (i, phase) => void (heldRestack[i] = phase),
    holdPeek: (i, amount) => void (heldPeek[i] = amount),
    holdGlance: (i, name) => glancers[i]?.freeze(name) ?? false,
    holdAct: (i, act, phase) => puppets[i]?.arms.hold(act as Act | undefined, phase),
    resetPeaks: () => {
      api.table!.seats.forEach((r) => (r.peak = freshPeak()));
      api.table!.spoke.length = 0;
    },
  };
  if (duet) api.table.duet = { band: band!, stacked, lit: [1, 1], halo: [0, 0], speaker: null };
  api.eyeBones = frames.every((f) => f.eyeBones);

  /** Whose line has the mouth: the seat whose line began last. The voice is one node, and the hub speaks one line at a time. */
  let speaking: number | undefined;
  /** Who is thinking aloud now (VIK-98): the mouth stays still, the plate is spotlit. */
  let aloud: number | undefined;
  /** Whose thoughts the table voices, as the hub last said (it starts with every seat's). */
  let listening: { mode: "seat" | "all" | "off"; seat?: string } = { mode: "all" };
  const spotlight = () => overlay.setSpotlight(listening.mode === "seat" ? listening.seat : aloud !== undefined ? seats[aloud]!.seat : undefined);
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
  /** What each seat's fidgets need to know of the table: cards in hand, chips in front, how restless the character is. */
  const seatFacts: { cards: boolean; chips: boolean; fidgety: number }[] = [];
  const row_fidget: (FidgetKind | undefined)[] = [];
  const show = (state: Parameters<typeof cuesFor>[1], o: { snap?: boolean; silent?: boolean } = {}) => {
    const moved = !o.silent && state.event && ACTIONS.has(state.event.kind) && state.event.seat_id !== undefined ? seats.findIndex((s) => s.seat === state.event!.seat_id) : -1;
    if (moved >= 0) {
      actor = moved;
      clearTimeout(actorTimer);
      const act = actFor(state.event!.kind);
      if (act) api.table!.acted.push({ seat: seats[moved]!.seat, act, how: puppets[moved]!.act(act) }); // the hands act the decision, or a nod where the arms cannot (VIK-137)
      actorTimer = setTimeout(() => ((actor = undefined), refocus()), ACTOR_GAZE_MS);
      refocus();
    }
    if (!o.silent && state.event) {
      const ev = state.event;
      const who = ev.seat_id !== undefined ? seats.findIndex((x) => x.seat === ev.seat_id) : -1;
      if (ev.kind === "new_hand") direct({ kind: "new_hand" });
      else if (ev.kind === "street") direct({ kind: "street" });
      else if (ev.kind === "showdown") direct({ kind: "showdown" });
      else if (ev.kind === "win" && who >= 0) direct({ kind: "win", seat: who });
      else if (ACTIONS.has(ev.kind) && who >= 0) direct({ kind: "action", seat: who, big: /all in/i.test(ev.text) || (ev.amount ?? 0) >= 0.5 * (state.pot ?? 0) });
    }
    overlay.setState(state);
    panel?.setState(state);
    const barWasHidden = topBar?.root.hidden ?? false;
    topBar?.setState(state);
    if (barWasHidden) gridDirty = true; // the grid's tiles start below the bar, which has just appeared
    props?.setState(state, o.snap);
    state.seats.forEach((st) => {
      const i = seats.findIndex((x) => x.seat === st.seat_id);
      if (i >= 0) seatFacts[i] = { cards: !st.folded && (st.cards?.length ?? 0) > 0, chips: st.stack > 0, fidgety: st.fidgety ?? 0.5 };
    });
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
      if (line?.commentary) {
        if (phase === "start") speaking = undefined; // the voice is the commentator's: the last speaker's mouth must not follow it (VIK-109)
        return;
      }
      const i = seatFor(seats, line);
      if (i === undefined) return;
      if (line?.thought) {
        // A thought said aloud (VIK-98): the seat feels it but its mouth stays still, and its plate is spotlit while it plays.
        if (phase === "start") {
          aloud = i;
          puppets[i]!.emotion.set(emotion, intensity);
        } else {
          if (aloud === i) aloud = undefined;
          puppets[i]!.emotion.release(0.7);
        }
        spotlight();
        return;
      }
      if (phase === "start") {
        speaking = talker = i;
        puppets[i]!.emotion.set(emotion, intensity);
        direct({ kind: "speak", seat: i });
      } else {
        if (talker === i) talker = undefined;
        puppets[i]!.emotion.release(0.7);
        direct({ kind: "line_end", seat: i });
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
      overlay.setPovCaption(seats[i]!.seat, t.text);
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
    onListenState: (mode, seat) => {
      listening = { mode, ...(seat !== undefined ? { seat } : {}) };
      panel?.setListen(mode, seat);
      spotlight();
      overlay.setGridSpot(mode === "seat" ? seat : undefined);
      // Listening in to a seat takes the camera to its eyes (VIK-99); stopping brings it back to the wide shot.
      const at = mode === "seat" ? seats.findIndex((x) => x.seat === seat) : -1;
      if (at >= 0) cutTo(`pov:${at}` as ShotName, true);
      else if (shotName.startsWith("pov:")) cutTo("wide", true);
      api.table!.listen = { ...listening };
    },
    onTransportState: (p) => {
      transport.available = true;
      transport.paused = p;
      refreshBar();
    },
    onText: (line) => {
      if (line.commentary) {
        // The commentator (VIK-109): its own strip, never the chat or a seat's bubble.
        overlay.addCommentary(line);
        return;
      }
      if (line.thought) {
        // A monologue spoken aloud (VIK-121): a thought bubble and the Thoughts list, never the chat.
        if (line.text !== undefined) {
          overlay.addSpokenThought(line.seat, line.text);
          overlay.setPovCaption(line.seat, line.text);
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
  panel?.setCameraHandler((shot) => cutTo(shot as ShotName, true));
  panel?.setDirectorHandler((on) => {
    director.enabled = on;
    panel?.setDirector(on);
  });
  panel?.setDirector(director.enabled);
  panel?.setCameraShot(shotName);
  // Keys: 1 wide, 2 overhead, 3 and on a close-up of each player (VIK-95); not while typing.
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || t?.matches?.("input, textarea, select, [contenteditable]")) return;
    const n = Number(e.key);
    if (e.key.toLowerCase() === "d") return void panel?.toggleDirector(); // the auto-director on or off
    if (e.key.toLowerCase() === "b") return cutTo("board", true);
    if (e.key.toLowerCase() === "g") return cutTo("grid", true);
    if (!Number.isInteger(n) || n < 1 || n > 2 + seats.length) return;
    cutTo(n === 1 ? "wide" : n === 2 ? "overhead" : (`seat:${n - 3}` as ShotName), true);
  });
  panel?.setListenHandler((mode, seat) => void player.sendListen(mode, seat));
  panel?.setRebuyHandler((seat) => void player.sendAudienceRequest("rebuy", seat)); // the audience buys a broke seat back in (VIK-108)
  overlay.onSelect = (seat) => panel?.chooseSeat(seat); // a click on a player's plate listens in, as its button does
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

  /** Each seat's fidgets (VIK-102, VIK-103): the scheduler picks and times them, the page plays the ones it can. `?fidget=off` leaves the seats still, `?fidget=fast` shortens the waits for a test. */
  const fidgetParam = params.get("fidget");
  const fidgetPace = fidgetParam === "fast" ? 0.1 : 1;
  const glancers = spots && den && fidgetParam !== "off" ? spots.map((spot, i) => new Glancer(mulberry32(seed + 101 * (i + 1)), den!.lookTargets, spot, frames[i]!.head)) : [];
  const schedulers = glancers.map((g, i) => new FidgetScheduler(mulberry32(seed + 211 * (i + 1)), { enabled: new Set<FidgetKind>([...(g.any ? (["look"] as const) : []), ...(props ? (["peek", "restack"] as const) : []), "tap", "lean", "stretch", "scratch"]), arms: puppets[i]!.canAct }, 0.5, fidgetPace));
  const gazes: (Glance | undefined)[] = [];
  /** A peek in progress per seat: the seconds so far and its length; and how far the cards are lifted now (eased, so a seat that must stop puts them down gently). */
  const peeking: ({ t: number; seconds: number } | undefined)[] = [];
  const lifted: number[] = [];
  const heldPeek: (number | undefined)[] = [];
  const heldRestack: (number | undefined)[] = [];
  /** An idle extra in progress per seat (VIK-106), run to its end faster when cut short, as a restack is. */
  const extras: ({ kind: ExtraKind; t: number; seconds: number } | undefined)[] = [];
  const heldExtra: ({ kind: ExtraKind; phase: number } | undefined)[] = [];
  /** A restack in progress per seat (VIK-105): it runs to its end even when the seat must stop, faster, so a lifted chip does not jump back. */
  const restacking: ({ t: number; seconds: number } | undefined)[] = [];
  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const voice: VisemeWeights = session.lipsync?.weights ?? {};
    props?.update(dt); // chips thrown in, cards pushed away (VIK-113)
    puppets.forEach((p, i) => {
      let glance: Glance | undefined;
      const sched = schedulers[i];
      if (sched) {
        const facts = seatFacts[i] ?? { cards: false, chips: false, fidgety: 0.5 };
        sched.fidgety = facts.fidgety;
        const step = sched.update(dt, { allowed: talker !== i && (focused === undefined || focused === i) && !p.busy, thinking: thinker === i, cards: facts.cards && lastState?.street !== "showdown", chips: facts.chips });
        if (step.started?.kind === "look") gazes[i] = glancers[i]!.begin();
        if (step.active !== "look") gazes[i] = undefined;
        if (step.started?.kind === "peek") peeking[i] = { t: 0, seconds: step.started.seconds };
        if (step.active !== "peek") peeking[i] = undefined;
        if (step.started?.kind === "restack") restacking[i] = { t: 0, seconds: step.started.seconds };
        if (isExtra(step.started?.kind)) extras[i] = { kind: step.started.kind, t: 0, seconds: step.started.seconds };
        const pk = peeking[i];
        let target = 0;
        const held = heldPeek[i];
        if (held !== undefined) {
          target = held;
          gazes[i] = { target: "peek", yaw: 0, pitch: PEEK_HEAD * Math.min(1, held * 1.5) };
        } else if (pk) {
          pk.t += dt;
          const ph = peekPhase(pk.t / pk.seconds);
          target = ph.cards;
          gazes[i] = { target: "peek", yaw: 0, pitch: PEEK_HEAD * ph.head }; // the head dips to the cards and lifts again
        } else if (gazes[i]?.target === "peek") gazes[i] = undefined;
        const hr = heldRestack[i];
        const rs = hr !== undefined ? { t: hr, seconds: 1 } : restacking[i];
        let reach = 0;
        if (rs) {
          if (hr === undefined) rs.t += dt * (step.active === "restack" ? 1 : 3);
          const ph = rs.t / rs.seconds;
          if (ph >= 1) restacking[i] = undefined;
          else {
            reach = restackReach(ph);
            props?.setRestack(i, ph);
            if (!gazes[i] || gazes[i]!.target === "chips") gazes[i] = { target: "chips", yaw: 0, pitch: 0.2 * reach }; // the head dips to the chips
            p.arms.reach(p.canAct ? reach : 0, 0.07 * Math.sin(ph * Math.PI * 7)); // a hand reaches in where the avatar's arm can; else the chips and the head alone
          }
        }
        if (!restacking[i] && hr === undefined) {
          props?.setRestack(i, 0);
          p.arms.reach(0);
          if (gazes[i]?.target === "chips") gazes[i] = undefined;
        }
        const he = heldExtra[i];
        const ex = he ? { kind: he.kind, t: he.phase, seconds: 1 } : extras[i];
        if (ex) {
          if (!he) ex.t += dt * (step.active === ex.kind ? 1 : 3);
          const ph = ex.t / ex.seconds;
          if (ph >= 1) extras[i] = undefined;
          else {
            const pose = extraPose(ex.kind, ph);
            p.arms.extra(p.canAct ? pose.arms : undefined);
            p.lean(pose.lean);
            if (!gazes[i] || gazes[i]!.target === "extra") gazes[i] = { target: "extra", yaw: pose.head.yaw, pitch: pose.head.pitch };
          }
        }
        if (!extras[i] && !he) {
          p.arms.extra(undefined);
          p.lean(0);
          if (gazes[i]?.target === "extra") gazes[i] = undefined;
        }
        lifted[i] = (lifted[i] ?? 0) + (target - (lifted[i] ?? 0)) * (1 - Math.exp(-Math.min(dt, 0.05) / 0.08));
        props?.setPeek(i, lifted[i]! < 0.01 ? 0 : lifted[i]!);
        glance = glancers[i]!.held ?? gazes[i];
        row_fidget[i] = step.active;
      }
      p.reaction.glance(glance);
      p.update(dt, i === speaking ? voice : {});
      symbols[i]!.update(dt, p.emotion.pose);
      const row = api.table!.seats[i]!;
      row.visemes = p.visemes;
      row.symbol = p.emotion.pose.symbol ?? null;
      row.look = p.reaction.looking;
      row.glance = glance?.target;
      row.fidget = row_fidget[i];
      if (row.fidget) row.peak.fidgets.add(row.fidget);
      if (glance && glance.target !== "peek" && glance.target !== "chips" && glance.target !== "extra") row.peak.glances.add(glance.target);
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
    const next = director.tick(now());
    if (next) cutTo(next);
    if (rig?.moving) applyShot(rig.update(dt)); // glide between shots (VIK-95)
    if (rig && shotName.startsWith("pov:") && rig.progress > 0.85) hideHead(Number(shotName.slice(4)));
    if (api.table) api.table.camera = { shot: shotName, director: director.enabled, moving: rig?.moving ?? false, position: [camera.position.x, camera.position.y, camera.position.z], grid: gridOn ? { every: gridInterval(frameMs), tiles: tileShots.slice() } : undefined };
    frameMs = frameMs * 0.9 + dt * 1000 * 0.1;
    if (gridOn) {
      if (gridDirty || ++gridFrame % gridInterval(frameMs) === 0) drawGrid();
    } else {
      renderer.render(scene, camera);
      if (api.table) api.table.render = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, frameMs }; // the room's cost, for the guard (VIK-107)
    }
  });
} catch (err) {
  console.error(err);
  say(`error: ${(err as Error).message}`);
}
