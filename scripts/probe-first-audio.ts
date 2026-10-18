// Dev helper: how long until a viewer gets the first sound of a line, with the real voice (VIK-116). It times two things for lines of several
// lengths, a few times each: the engine alone (`synthesize` to its first chunk), and the whole hub path (a driver sends an utterance, a viewer
// receives the first `audio` message with samples). The gap is the pipeline's own cost; the playing page adds a few ms more.
// Needs `make install-voice`. Run it when the machine is quiet: other work on the CPU inflates every number.
//   pnpm exec tsx scripts/probe-first-audio.ts [--runs 3] [--dtype fp32|fp16|q8|q4]   (the default is what the engine would use)
import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { findVoice } from "../packages/cli/src/voice.ts";
import { make, parseMessage } from "../packages/protocol/src/index.ts";
import { startServer } from "../packages/server/src/server.ts";
import { chosenDtype, KokoroTts } from "../packages/tts/src/index.ts";

const WebSocket = createRequire(new URL("../packages/server/package.json", import.meta.url))("ws") as typeof import("ws").WebSocket; // `ws` is the server package's dependency

const arg = (name: string, d: number) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : d);
const runs = arg("--runs", 3);
const LINES = [
  "Check.",
  "I call, and I like it.",
  "Hmm, that is a big bet. I will call and see.",
  "Well now, that is a lot of chips to put in the middle on a flop like this, but fine, I will call and see what you have got.",
];
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const ms = (n: number) => `${Math.round(n)} ms`;

const t0 = performance.now();
const dtype = process.argv.includes("--dtype") ? (process.argv[process.argv.indexOf("--dtype") + 1] as "fp32" | "fp16" | "q8" | "q4") : undefined;
const tts = await KokoroTts.create({ importFrom: findVoice()!.entry, ...(dtype ? { dtype } : {}) });
console.log(`weights ${dtype ?? chosenDtype()}, cpus ${os.cpus().length}, load ${os.loadavg()[0]!.toFixed(1)}; model ready in ${ms(performance.now() - t0)}`);

const server = await startServer({ staticDir: fileURLToPath(new URL("../packages/engine/dist", import.meta.url)), speech: { tts } });
const open = (role: "viewer" | "driver") =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(server.wsUrl);
    ws.once("error", reject);
    ws.once("open", () => {
      ws.send(JSON.stringify(make("hello", { role })));
      ws.once("message", () => resolve(ws)); // the welcome
    });
  });
const viewer = await open("viewer");
const driver = await open("driver");

let firstAudio: ((t: number) => void) | undefined;
viewer.on("message", (raw) => {
  const p = parseMessage(String(raw));
  if (!p.ok) return;
  const m = p.message;
  if (m.type === "audio" && m.pcm.length > 0 && firstAudio) {
    firstAudio(performance.now());
    firstAudio = undefined;
  }
  if (m.type === "audio" && m.final) viewer.send(JSON.stringify(make("speech_started", { utterance_id: m.utterance_id })), () => viewer.send(JSON.stringify(make("speech_finished", { utterance_id: m.utterance_id }))));
});

console.log("\nline (characters)                       engine first audio   hub: utterance to first audio");
let n = 0;
for (const text of LINES) {
  const engine: number[] = [];
  const hub: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    let first = true;
    for await (const _ of tts.synthesize({ text })) {
      if (first) engine.push(performance.now() - s);
      first = false; // read it to the end: a worker that is still making the next piece would delay the hub measurement that follows
      void _;
    }
    await new Promise((r) => setTimeout(r, 300));
    const sent = performance.now();
    const got = new Promise<number>((r) => (firstAudio = r));
    driver.send(JSON.stringify(make("utterance", { utterance_id: `p${n++}`, seat_id: "s", text })));
    hub.push((await got) - sent);
    await new Promise((r) => setTimeout(r, 2500)); // let the line finish before the next
  }
  console.log(`${text.slice(0, 34).padEnd(34)} (${String(text.length).padStart(3)})   ${ms(median(engine)).padStart(10)}        ${ms(median(hub)).padStart(10)}   [${hub.map((x) => Math.round(x)).join(", ")}]`);
}
await server.close();
await tts.close();
process.exit(0);
