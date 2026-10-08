// Shape of the test hook the avatar page exposes (see packages/engine/src/main.ts).
interface Window {
  __vikaki?: {
    ready: boolean;
    avatar?: unknown;
    mic: "idle" | "listening" | "error";
    visemes: Record<string, number>;
    applied: Record<string, number>;
    timeline?: unknown;
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
