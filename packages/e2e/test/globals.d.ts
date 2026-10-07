// Shape of the test hook the avatar page exposes (see packages/engine/src/main.ts).
interface Window {
  __vikaki?: { ready: boolean; avatar?: unknown; setVisemes(w: Record<string, number>): void };
}
