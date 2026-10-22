// How much speech a game has and what it would cost to say it with each provider (VIK-140). Pure: it reads a hub event log (`vikaki serve --event-log`)
// and a price table, so the estimate for a 20-hand game comes from a game that was actually played, not a guess.

/** The speech in an event log: every utterance, whole or in deltas, counted once. The hub speaks everything a driver sends, thoughts included. */
export interface SpeechStats {
  lines: number;
  characters: number;
  /** An estimate: people speak about 15 characters a second at a relaxed pace. */
  minutes: number;
  /** How long the game ran, from the first event to the last, when the log has times: a rented pod bills for all of it, not just for making the speech. */
  wallMinutes?: number;
}

export const CHARS_PER_SECOND = 15;

export function speechStats(events: { at?: number; message: Record<string, unknown> }[]): SpeechStats {
  const text = new Map<string, number>();
  for (const { message: m } of events) {
    if (m.type !== "utterance" || typeof m.utterance_id !== "string") continue;
    const id = m.utterance_id;
    if (typeof m.text === "string") text.set(id, m.text.length);
    else if (typeof m.delta === "string") text.set(id, (text.get(id) ?? 0) + m.delta.length);
  }
  const characters = [...text.values()].reduce((a, b) => a + b, 0);
  const times = events.map((e) => e.at).filter((t): t is number => typeof t === "number");
  const wall = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 60000 : undefined;
  return { lines: text.size, characters, minutes: characters / CHARS_PER_SECOND / 60, ...(wall !== undefined ? { wallMinutes: wall } : {}) };
}

/** What a provider charges. Prices change: `asOf` says when each was read, and every figure here is an assumption to check before spending. */
export interface Price {
  name: string;
  /** Dollars per minute of audio (a hosted API), or per GPU hour with how many times faster than real time the model runs on that GPU. */
  perMinute?: number;
  gpuPerHour?: number;
  realtimeFactor?: number;
  asOf: string;
  note: string;
}

export const PRICES: Price[] = [
  { name: "Kokoro (local)", perMinute: 0, asOf: "2026-10", note: "runs on this machine; costs nothing but the 330 MB download" },
  { name: "OpenAI gpt-4o-mini-tts", perMinute: 0.015, asOf: "2026-10", note: "published as about $0.015 per minute of audio; check the pricing page" },
  { name: "Chatterbox on RunPod", gpuPerHour: 0.4, realtimeFactor: 2, asOf: "2026-10", note: "an assumed community-cloud 24 GB GPU at about $0.40 an hour that makes speech twice as fast as it plays; the pod bills while it is up, so the whole game counts, and a cold start on top; tear it down after" },
  { name: "Qwen3-TTS on RunPod", gpuPerHour: 0.4, realtimeFactor: 2, asOf: "2026-10", note: "the same assumption as Chatterbox; Apache-2.0, so no licence fee" },
];

/** Dollars to say `stats` with `price`. A rented GPU bills while the pod is up: the whole game (`wallMinutes`) if the log says how long it ran, else the time it takes to make the speech. */
export function costOf(stats: SpeechStats, price: Price): number {
  if (price.perMinute !== undefined) return stats.minutes * price.perMinute;
  if (price.gpuPerHour !== undefined && price.realtimeFactor) return (Math.max(stats.minutes / price.realtimeFactor, stats.wallMinutes ?? 0) / 60) * price.gpuPerHour;
  return 0;
}
