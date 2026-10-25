// Shape of the test hook the avatar page exposes (see packages/engine/src/main.ts).
interface Window {
  __vikaki?: {
    ready: boolean;
    avatar?: unknown;
    mic: "idle" | "listening" | "error";
    visemes: Record<string, number>;
    applied: Record<string, number>;
    timeline?: unknown;
    mouthMode?: "audio" | "phoneme" | "hybrid";
    phonemes?: { size: number; all(): readonly { utteranceId: string; p: string; startMs: number; endMs: number; stress: number }[]; at(perfMs: number): { p: string } | undefined };
    timelineUi?: { mode(): string; select(m: string): void; exportPng(): string; exportJson(): string; exportLayout(): { width: number; height: number; gutter: number; lanes: { id: string; top: number; height: number }[] } };
    blink: number;
    blinks: number;
    setVisemes(w: Record<string, number>): void;
    setEmotion(emotion: string | undefined, intensity?: number): void;
    setThinking(on: boolean): void;
    persona?: string;
    audioOnly?: boolean;
    avatarUrl?: string;
    prosody?: { cues: { cue: string; t: number }[] };
    head?: { pitch: number; yaw: number; roll: number };
    gesture?: { pitch: number; roll: number };
    gesturePeak?: { pitch: number; roll: number };
    /** The emotion pose on show after the last frame, and what the preset for an emotion at an intensity says. */
    emotionPose?: EmotionPose;
    presetPose?: (emotion: string, intensity: number) => EmotionPose;
    live?: { state: string; soundBlocked: boolean; events: string[] };
    /** The audio context's state, buffers sent to the speakers, and the audio clock. */
    audio?: { state: string; played: number; time: number | undefined; /** The table voices' level, and the gain node's value once one exists (VIK-109). */ voice?: { volume: number; muted: boolean; gain: number | undefined } };
    table?: { seats: { seat: string; persona?: string; avatarUrl: string; x: number; visemes: Record<string, number>; symbol: string | null; look: number; /** The thing in the room being looked at now, if any (VIK-102). */ glance?: string; /** The fidget running now (VIK-103). */ fidget?: string; yaw: number; pitch: number; roll: number; /** In the 3D view: metres the knees are ahead of the hips toward the table. */ kneeReach?: number; /** Since the last `resetPeaks()`, over every frame drawn. */ peak: { yawMin: number; yawMax: number; mouth: number; symbols: Set<string>; /** The seat was told it is thinking, whether or not a frame drew the dots. */ thought: boolean; /** The names of the things in the den this seat glanced at (VIK-102). */ glances: Set<string>; /** The kinds of fidget this seat has done (VIK-103). */ fidgets: Set<string> } }[]; /** Seats whose mouth was the widest (over 0.3), in order, one entry per change. */ spoke: number[]; resetPeaks(): void; /** `table` when the seats sit round a 3D table (`?view=table`), else `row`. */ view: "row" | "table"; /** `?layout=duet`: the band the host draws over, whether the avatars are stacked above it, each avatar's brightness and halo, and the seat in the light. */ duet?: { band: { left: number; top: number; width: number; height: number }; stacked: boolean; lit: number[]; halo: number[]; speaker: string | null }; /** In the 3D view: what `table_state` has put on the table, for tests. */ props?: { /** Whether each seat's chips are being riffled (VIK-105). */ restacking: boolean[]; /** How far each seat's cards are lifted in a peek (VIK-104). */ peeked: number[]; boardCards: number; seatCards: number[]; chips: number; dealer: string | undefined; pot: string | undefined; handsFaceUp: boolean; /** Cards lit up as the five that make the winning hand (VIK-94). */ highlighted: number }; /** Sound effects (VIK-122): the cues asked for while unmuted, whether or not the browser let them sound; the level and mute. */ sfx?: { cues: string[]; volume: number; muted: boolean }; /** Playback (VIK-135). */ transport?: { available: boolean; paused: boolean; reviewing: boolean; position: number; length: number }; /** Decisions acted by the hands or, where the arms cannot, a nod (VIK-137). */ den?: { triangles: number; targets: string[] }; render?: { calls: number; triangles: number; frameMs: number }; acted: { seat: string; act: string; how: "arms" | "nod" }[]; /** Whose thoughts the table voices now (VIK-98). */ listen: { mode: "seat" | "all" | "off"; seat?: string }; /** The camera (VIK-95): the shot on, whether it is gliding, and where it is. */ camera?: { shot: string; director: boolean; moving: boolean; position: number[]; /** The POV grid (VIK-100): how often it is drawn (every this many frames) and the viewpoint of each tile. */ grid?: { every: number; tiles: { seat: string; position: number[]; fov: number }[] } }; /** Freeze a seat's arms mid-act, or let go with `undefined`, to look at the pose in a picture. */ /** Hold a seat's glance at a named thing in the den, or let go with `undefined` (VIK-102); false when it cannot look there. */ /** Hold a seat's peek at the cards at this amount from 0 to 1, or let go with `undefined` (VIK-104). */ /** Hold a seat's chip restack at this phase from 0 to 1, or let go with `undefined` (VIK-105). */ /** Hold a seat in an idle extra (`tap`, `lean`, `stretch` or `scratch`) at a phase from 0 to 1, or let go with no kind (VIK-106). */ holdExtra(seat: number, kind: string | undefined, phase: number): void; holdRestack(seat: number, phase: number | undefined): void; holdPeek(seat: number, amount: number | undefined): void; holdGlance(seat: number, target: string | undefined): boolean; holdAct(seat: number, act: string | undefined, phase?: number): void; };
  };
}

interface EmotionPose {
  squint: number;
  pitch: number;
  roll: number;
  yaw: number;
  shake: number;
  bob: number;
  rest: Record<string, number>;
  symbol: string | null;
  symbolAmount: number;
}
