// Shape of the test hook the avatar page exposes (see packages/engine/src/main.ts).
interface Window {
  __vikaki?: {
    ready: boolean;
    avatar?: unknown;
    mic: "idle" | "listening" | "error";
    visemes: Record<string, number>;
    applied: Record<string, number>;
    blink: number;
    blinks: number;
    setVisemes(w: Record<string, number>): void;
    live?: { state: string; soundBlocked: boolean; events: string[] };
  };
}
