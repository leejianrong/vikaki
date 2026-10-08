#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DebugRecorder, EventLog, findFreePort, loadPersonas, PersonaError, startServer } from "@vikaki/server";
import { cancel, replay, say, type Io } from "./commands.ts";
import { runMcp } from "./mcp.ts";
import { hubUrl } from "./hub-client.ts";
import { resolve } from "node:path";
import { formatChecks, realDoctorEnv, runDoctor } from "./doctor.ts";
import { findVoice, INSTALL_COMMAND } from "./voice.ts";
import { FakeTts, KokoroTts, type Tts } from "@vikaki/tts";

const USAGE = `usage: vikaki doctor            check that everything the demos need is in place
       vikaki serve [--port N] [--host 127.0.0.1] [--static <dir>] [--demo | --speech-demo] [--open]
                    [--tts auto|kokoro|fake|none] [--voice <id>] [--token <secret>] [--debug-dir <dir|off>]
                    [--event-log <file.jsonl>] [--personas <personas.yaml>]
       vikaki say <text...> [--persona <name>] [--emotion <name>] [--think <seconds>]
                                     speak one line and wait until it is over; --think shows the avatar thinking first
       vikaki cancel [<utterance_id>]    stop what the avatar is saying (everything, or one line)
       vikaki mcp                        MCP server on stdio so an LLM can drive the avatar (tools: say, set_emotion, set_persona, cancel)
       vikaki replay <file.jsonl> [--speed N]   send a recorded session's driver messages again

  say, cancel, replay and mcp talk to a running \`vikaki serve\`: add [--port N | --url ws://host:port/ws] [--token <secret>].

  --port N   exact port, fails if busy. Without it, starts at 8787 and takes the next free port.
  --demo     the demo page: avatar plus mic, audio-file and mouth-shape controls
  --speech-demo  the speech demo: type text, press Speak, watch and hear the avatar say it
  --open     open the page in your browser (works from WSL, macOS and Linux)
  --tts      speech engine. auto uses Kokoro if installed, else a test voice. none turns speech off.
  --voice    default Kokoro voice, such as af_heart
  --debug-dir  save each spoken utterance (wav, spectrogram, metrics, text, timings) under <dir>.
             On by default for --speech-demo, into .vikaki/debug. "off" turns it off.
  --token    require this token from the driver (or set VIKAKI_TOKEN)
  --personas  a personas file: named characters (avatar, voice, default emotion, style). A line naming a persona the file lacks is refused.
  --event-log  write every message the hub sees, one JSON object per line (audio as its size only). Feed it to \`vikaki replay\`.`;

// Default to the engine's built page (run \`pnpm build\` first).
const defaultStatic = fileURLToPath(new URL("../../engine/dist", import.meta.url));

/** Try the usual openers in order; WSL needs to reach the Windows browser. */
function openBrowser(url: string): void {
  const candidates: [string, string[]][] = [
    ["wslview", [url]],
    ["explorer.exe", [url]],
    ["xdg-open", [url]],
    ["open", [url]],
  ];
  const tryNext = (i: number) => {
    const c = candidates[i];
    if (!c) {
      console.log("could not open a browser automatically; open the URL above yourself");
      return;
    }
    const child = spawn(c[0], c[1], { stdio: "ignore", detached: true });
    child.once("error", () => tryNext(i + 1));
    child.unref();
  };
  tryNext(0);
}

/** Pick a speech engine, and say plainly what was chosen and why. */
async function chooseTts(kind: string, voice: string | undefined): Promise<{ tts: Tts; voice?: string } | undefined> {
  if (kind === "none") return undefined;
  if (kind === "fake") return { tts: new FakeTts() };
  const found = findVoice();
  if (!found && kind === "auto") {
    console.log("");
    console.log("  !! The real voice is not installed, so this will play a steady \"aah\" test tone, not speech.");
    console.log(`  !! Run \`${INSTALL_COMMAND}\` once (about 410 MB), then start again.`);
    console.log("");
    return { tts: new FakeTts() };
  }
  console.log("loading the voice (the first run downloads a model of about 90 MB)...");
  const tts = await KokoroTts.create({ voice, importFrom: found?.entry });
  return { tts, voice: voice ?? "af_heart" };
}

async function serve(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      static: { type: "string", default: defaultStatic },
      demo: { type: "boolean", default: false },
      "speech-demo": { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      tts: { type: "string", default: "auto" },
      voice: { type: "string" },
      token: { type: "string" },
      "debug-dir": { type: "string" },
      "event-log": { type: "string" },
      personas: { type: "string" },
    },
  });
  if (!["auto", "kokoro", "fake", "none"].includes(values.tts!)) {
    console.error(`--tts must be auto, kokoro, fake or none, not "${values.tts}"`);
    process.exit(1);
  }
  if (!existsSync(values.static!)) {
    console.error(`no built page at ${values.static}; run \`pnpm build\` first`);
    process.exit(1);
  }
  const host = values.host!;
  const port = values.port !== undefined ? Number(values.port) : await findFreePort(8787, host);
  const chosen = await chooseTts(values.tts!, values.voice).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
  const tts = chosen?.tts;
  const token = values.token ?? process.env.VIKAKI_TOKEN;
  const debugArg = values["debug-dir"] ?? (values["speech-demo"] ? ".vikaki/debug" : undefined);
  const debugDir = debugArg && debugArg !== "off" && tts ? resolve(debugArg) : undefined;
  const recorder = debugDir
    ? new DebugRecorder({
        dir: debugDir,
        onSaved: (f) => console.log(`  debug: saved ${f}`),
        onError: (err) => console.error(`  debug: could not save a recording: ${err instanceof Error ? err.message : err}`),
      })
    : undefined;
  const personas = values.personas
    ? await loadPersonas(resolve(values.personas)).catch((err) => {
        console.error(err instanceof PersonaError ? err.message : err);
        process.exit(1);
      })
    : undefined;
  const eventLog = values["event-log"] ? new EventLog(resolve(values["event-log"])) : undefined;
  const server = await startServer({
    staticDir: values.static!,
    port,
    host,
    personas,
    hub: { ...(token ? { token } : {}), onEvent: eventLog?.record },
    speech: tts
      ? { tts, defaultVoice: chosen?.voice, observer: recorder, onTiming: (t) => console.log(`  ${t.utterance_id}: first audio made ${t.firstAudioAt - t.textAt} ms after the text arrived`) }
      : undefined,
  });
  const url = values["speech-demo"] ? `${server.url}?demo=speech&live=1` : values.demo ? `${server.url}?demo=1&live=1` : `${server.url}?live=1`;
  console.log(`vikaki serving ${url}`);
  console.log(`  drivers connect to ${server.wsUrl}${token ? " (token required)" : ""}; speech: ${tts ? tts.name : "off"}`);
  if (values.port === undefined && port !== 8787) console.log(`(8787 was busy, using ${port})`);
  if (debugDir) console.log(`  debug recordings: ${debugDir}`);
  if (personas) console.log(`  personas: ${personas.names.join(", ")}`);
  if (eventLog) console.log(`  event log: ${resolve(values["event-log"]!)}`);
  console.log("press Ctrl+C to stop");
  if (values.open) openBrowser(url);

  // Stop on purpose: say so, close the server, exit 0. A second Ctrl+C (or a hung close) forces the exit.
  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping...");
    await recorder?.flush();
    await eventLog?.close();
    // the engine's worker is stopped too, after it has finished what it is in the middle of (stopping it mid-run can crash the process)
    const closed = Promise.all([server.close(), tts?.close?.()]).then(() => true, () => false);
    const timeout = new Promise<false>((ok) => setTimeout(() => ok(false), 12_000));
    const clean = await Promise.race([closed, timeout]);
    console.log(clean ? "Stopped." : "Stopped (some connections were still open and were dropped).");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const consoleIo: Io = { out: (l) => console.log(l), err: (l) => console.error(l) };

/** Options shared by say, cancel and replay: where the hub is. */
const TARGET_OPTIONS = { port: { type: "string" }, url: { type: "string" }, token: { type: "string" } } as const;
const targetOf = (v: { port?: string; url?: string; token?: string }) => ({ url: hubUrl(v), token: v.token ?? process.env.VIKAKI_TOKEN });

async function clientCommand(command: string, argv: string[]): Promise<number> {
  if (command === "say") {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { ...TARGET_OPTIONS, persona: { type: "string" }, emotion: { type: "string" }, seat: { type: "string" }, think: { type: "string" } } });
    const text = positionals.join(" ").trim();
    if (!text) {
      console.error("say what? usage: vikaki say <text...>");
      return 1;
    }
    // Ctrl+C asks the avatar to stop; a second one leaves at once.
    const ac = new AbortController();
    process.on("SIGINT", () => (ac.signal.aborted ? process.exit(130) : ac.abort()));
    return say({ ...targetOf(values), text, persona: values.persona, emotion: values.emotion, seat: values.seat, thinkSeconds: values.think ? Number(values.think) : undefined, signal: ac.signal }, consoleIo);
  }
  if (command === "mcp") {
    const { values } = parseArgs({ args: argv, options: TARGET_OPTIONS });
    await runMcp(targetOf(values)); // stdout belongs to the protocol: anything human goes to stderr
    return 0;
  }
  if (command === "cancel") {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: TARGET_OPTIONS });
    return cancel({ ...targetOf(values), utteranceId: positionals[0] }, consoleIo);
  }
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { ...TARGET_OPTIONS, speed: { type: "string", default: "1" } } });
  const speed = Number(values.speed);
  if (!positionals[0] || !(speed > 0)) {
    console.error("usage: vikaki replay <file.jsonl> [--speed N]   (N above 0)");
    return 1;
  }
  return (await replay({ ...targetOf(values), file: positionals[0], speed }, consoleIo)).code;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "serve") {
  await serve(rest);
} else if (command === "say" || command === "cancel" || command === "replay" || command === "mcp") {
  process.exit(await clientCommand(command, rest));
} else if (command === "doctor") {
  const checks = await runDoctor(await realDoctorEnv());
  console.log(formatChecks(checks));
  process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
} else {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
