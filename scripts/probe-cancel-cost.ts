// Dev helper: what does cancelling a sentence cost with the real voice? Measures (a) how long the CPU stays busy after a mid-sentence
// abort and (b) how much that delays the first audio of the line that follows. Needs `make install-voice`.
//   pnpm exec tsx scripts/probe-cancel-cost.ts
import { findVoice } from "../packages/cli/src/voice.ts";
import { KokoroTts } from "../packages/tts/src/index.ts";

const tts = await KokoroTts.create({ importFrom: findVoice()!.entry });
const SHORT = "Hello there, friend.";
const sentence = (chars: number) => ("This is a long sentence about nothing in particular that keeps going and going without a comma to stop it " + "and on and on ").repeat(4).slice(0, chars).replace(/\s+\S*$/, ".");

async function firstAudioMs(text: string, signal?: AbortSignal): Promise<number> {
  const started = performance.now();
  for await (const _chunk of tts.synthesize({ text, signal })) return performance.now() - started;
  return NaN;
}
/** Wall time until the process's CPU use falls under 15% for 300 ms. */
async function busyFor(): Promise<number> {
  const started = performance.now();
  let last = process.cpuUsage();
  let quiet = 0;
  while (quiet < 3) {
    await new Promise((r) => setTimeout(r, 100));
    const now = process.cpuUsage(last);
    last = process.cpuUsage();
    const busy = (now.user + now.system) / 1000 / 100; // fraction of one core over this 100 ms
    quiet = busy < 0.15 ? quiet + 1 : 0;
  }
  return performance.now() - started - 300;
}

await firstAudioMs(SHORT); // warm up
console.log(`short line on its own: ${(await firstAudioMs(SHORT)).toFixed(0)} ms to first audio`);
for (const chars of [60, 120, 200]) {
  const text = sentence(chars);
  const solo = await firstAudioMs(text);
  await busyFor();
  // cancel it 300 ms in, then ask for the short line at once
  const ctl = new AbortController();
  const running = (async () => { try { for await (const _ of tts.synthesize({ text, signal: ctl.signal })) break; } catch {} })();
  await new Promise((r) => setTimeout(r, 300));
  ctl.abort();
  await running;
  const afterCancel = await firstAudioMs(SHORT);
  const idle = await busyFor();
  console.log(`${String(chars).padStart(3)} chars: whole sentence ${solo.toFixed(0)} ms | cancelled at 300 ms, then the short line took ${afterCancel.toFixed(0)} ms to first audio; CPU idle ${idle.toFixed(0)} ms after that`);
}
await tts.close();
process.exit(0);
