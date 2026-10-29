#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_FRAME_ANCESTORS, DebugRecorder, EventLog, findFreePort, loadPersonas, parseAllowedHosts, parseFrameAncestors, PersonaError, startServer } from "@vikaki/server";
import { HeadlessRenderer, MjpegFeed, RendererUnavailable, startScreencast } from "@vikaki/render";
import { cancel, replay, say, type Io } from "./commands.ts";
import { runMcp } from "./mcp.ts";
import { playHand } from "./table-demo.ts";
import { startEmbedDemo } from "./embed-demo.ts";
import { fromHere } from "./paths.ts";
import { hubUrl } from "./hub-client.ts";
import { resolve } from "node:path";
import { formatChecks, realDoctorEnv, runDoctor } from "./doctor.ts";
import { findVoice, INSTALL_COMMAND } from "./voice.ts";
import { ChatterboxTts, FakeTts, KokoroTts, type Tts } from "@vikaki/tts";

const USAGE = `usage: vikaki doctor            check that everything the demos need is in place
       vikaki serve [--port N] [--host 127.0.0.1] [--static <dir>] [--demo | --speech-demo] [--open]
                    [--tts auto|kokoro|chatterbox|fake|none] [--voice <id>] [--token <secret>] [--frame-ancestors <origins|none>] [--debug-dir <dir|off>]
                    [--event-log <file.jsonl>] [--personas <personas.yaml>]
                    [--headless [--audio-only] [--gpu] [--chrome <path>]]
       vikaki stream [serve options] [--size 1280x720] [--fps 15] [--quality 80] [--background fff1e8|green] [--stream-persona <name>]
                                     serve, render headless and publish the avatar as an MJPEG feed at /stream.mjpg
       vikaki say <text...> [--persona <name>] [--emotion <name>] [--seat <id>] [--think <seconds>]
                                     speak one line and wait until it is over; --think shows the avatar thinking first.
                                     --seat claims that seat, so says for different seats of a table can run together
       vikaki cancel [<utterance_id>]    stop what the avatar is saying (everything, or one line)
       vikaki mcp [--seat <id>[:<persona>]]...
                                     MCP server on stdio so an LLM can drive the avatar (tools: say, set_emotion, set_persona, cancel).
                                     With --seat it speaks for that seat of a table only (repeat it for several): one server per LLM
       vikaki table-demo [--pace N]      a scripted hand of poker with one driver per seat; watch it at /avatar?seats=3
                                     (start the hub with --personas personas.table.example.yaml)
       vikaki embed-demo [--port N] [--hub-port N] [--tts auto|kokoro|fake] [--open]
                                     the embed work on one screen: a stand-in game page frames the duet layout, with a box to speak for either seat
       vikaki replay <file.jsonl> [--speed N]   send a recorded session's driver messages again

  say, cancel, replay and mcp talk to a running \`vikaki serve\`: add [--port N | --url ws://host:port/ws] [--token <secret>].

  --port N   exact port, fails if busy. Without it, starts at 8787 and takes the next free port.
  --demo     the demo page: avatar plus mic, audio-file and mouth-shape controls
  --speech-demo  the speech demo: type text, press Speak, watch and hear the avatar say it
  --open     open the page in your browser (works from WSL, macOS and Linux)
  --tts      speech engine. auto uses Kokoro if installed, else a test voice. none turns speech off. (or set VIKAKI_TTS)
  --voice    default Kokoro voice, such as af_heart
  --debug-dir  save each spoken utterance (wav, spectrogram, metrics, text, timings) under <dir>.
             On by default for --speech-demo, into .vikaki/debug. "off" turns it off.
  --token    require this token from the driver (or set VIKAKI_TOKEN)
  --frame-ancestors  origins whose pages may embed the avatar page in an iframe, comma-separated (default: localhost on any port; none: nobody) (or set VIKAKI_FRAME_ANCESTORS)
  --allow-host  extra Host names the hub answers, comma-separated (vikaki:8787, or a name for any port), for a hub behind a container network.
             Off by default: only 127.0.0.1, localhost and [::1] are answered, which is what stops DNS rebinding. (or set VIKAKI_ALLOWED_HOSTS)
  --phonemes  send the phonemes the voice spoke, with their times, on the audio (VIK-50): for pages that use them. Off by default. (or set VIKAKI_PHONEMES=1)
  --headless  also open the avatar page in a hidden Chromium (one tab per persona), so lines are rendered with no one at a screen.
             Needs the optional browser: \`make install-renderer\`. --audio-only opens audio-only pages that draw nothing;
             --gpu uses the machine's GPU instead of software WebGL; --chrome (or VIKAKI_CHROME) names a browser to use.
  stream     is serve with --headless and an MJPEG feed: VLC, ffplay, OBS (a media source) or a browser <img> can open
             http://127.0.0.1:<port>/stream.mjpg (one frame: /stream.jpg). --size, --fps and --quality set the picture;
             --background is a solid colour as 6 hex digits, or \`green\` for chroma keying (video cannot be transparent);
             --stream-persona says which persona's page to publish when there are several. With --token, add ?token=<secret>.
  --personas  a personas file: named characters (avatar, voice, default emotion, style). A line naming a persona the file lacks is refused. (or set VIKAKI_PERSONAS)
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
async function chooseTts(kind: string, voice: string | undefined, pieces = false): Promise<{ tts: Tts; voice?: string } | undefined> {
  if (kind === "none") return undefined;
  if (kind === "fake") return { tts: new FakeTts({ pieces }) };
  if (kind === "chatterbox") {
    // A Chatterbox server of your own (docs/tts.md, spikes/chatterbox/); the key, if it wants one, is CHATTERBOX_API_KEY and is never printed.
    const url = process.env.CHATTERBOX_URL;
    if (!url) throw new Error("--tts chatterbox needs CHATTERBOX_URL, the server's address up to /v1 (see docs/tts.md)");
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new Error("CHATTERBOX_URL is not a web address, such as http://host:8000/v1");
    }
    console.log(`speech: using the chatterbox server at ${origin} (nothing is sent until a line is said)`);
    return { tts: new ChatterboxTts({ baseUrl: url }) };
  }
  const found = findVoice();
  if (!found && kind === "auto") {
    console.log("");
    console.log("  !! The real voice is not installed, so this will play a steady \"aah\" test tone, not speech.");
    console.log(`  !! Run \`${INSTALL_COMMAND}\` once (about 410 MB), then start again.`);
    console.log("");
    return { tts: new FakeTts({ pieces }) };
  }
  console.log("loading the voice (the first run downloads a model of about 330 MB)...");
  const tts = await KokoroTts.create({ voice, importFrom: found?.entry });
  return { tts, voice: voice ?? "af_heart" };
}

/** `vikaki embed-demo`: the hub and a stand-in game page on another port, to see the embed work (docs/embed.md). */
async function embedDemo(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, "hub-port": { type: "string" }, tts: { type: "string", default: "auto" }, voice: { type: "string" }, static: { type: "string", default: defaultStatic }, open: { type: "boolean", default: false } } });
  // Free ports by default (from 8765 and 8787): another project's hub or game may already be on them.
  const hostPort = values.port !== undefined ? Number(values.port) : await findFreePort(8765);
  const hubPort = values["hub-port"] !== undefined ? Number(values["hub-port"]) : await findFreePort(hostPort === 8787 ? 8788 : 8787);
  if (!(hostPort > 0 && hubPort > 0 && hostPort !== hubPort) || !["auto", "kokoro", "fake"].includes(values.tts!)) {
    console.error("usage: vikaki embed-demo [--port N] [--hub-port N] [--tts auto|kokoro|fake] [--open]   (two different ports)");
    process.exit(1);
  }
  if (!existsSync(values.static!)) {
    console.error(`no built page at ${values.static}; run \`pnpm build\` first`);
    process.exit(1);
  }
  const chosen = await chooseTts(values.tts!, values.voice).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
  const hostOrigin = `http://127.0.0.1:${hostPort}`;
  // The stand-in page is another origin from the hub, as a game's would be, so the hub is told it may frame the avatar page.
  const server = await startServer({
    staticDir: values.static!,
    port: hubPort,
    frameAncestors: [hostOrigin],
    speech: chosen ? { tts: chosen.tts, defaultVoice: chosen.voice } : undefined,
  }).catch((err) => {
    console.error(`cannot start the hub on port ${hubPort}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
  const demo = await startEmbedDemo({ hubWs: server.wsUrl, hubOrigin: new URL(server.url).origin, port: hostPort }).catch(async (err) => {
    console.error(`cannot start the demo page on port ${hostPort}: ${err instanceof Error ? err.message : err}`);
    await server.close();
    process.exit(1);
  });
  console.log(`vikaki embed demo: open ${demo.origin}`);
  console.log(`  the page is the host (${demo.origin}); it frames the hub's avatar page (${new URL(server.url).origin}) with ?seats=2&embed=1&layout=duet`);
  console.log("  type a line and press Speak; press Start sound once (the frame is silent until the host sends `unlock`)");
  console.log("press Ctrl+C to stop");
  if (values.open) openBrowser(demo.origin);
  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping...");
    await demo.close();
    await Promise.race([Promise.all([server.close(), chosen?.tts.close?.()]), new Promise((ok) => setTimeout(ok, 12_000))]);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
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
      tts: { type: "string" },
      voice: { type: "string" },
      token: { type: "string" },
      "frame-ancestors": { type: "string" },
      "allow-host": { type: "string" },
      phonemes: { type: "boolean", default: false },
      "debug-dir": { type: "string" },
      "event-log": { type: "string" },
      personas: { type: "string" },
      headless: { type: "boolean", default: false },
      "audio-only": { type: "boolean", default: false },
      gpu: { type: "boolean", default: false },
      chrome: { type: "string" },
      stream: { type: "boolean", default: false },
      size: { type: "string", default: "1280x720" },
      fps: { type: "string", default: "15" },
      quality: { type: "string", default: "80" },
      background: { type: "string", default: "fff1e8" },
      "stream-persona": { type: "string" },
    },
  });
  // A container is configured through its environment (VIK-126): each setting has a VIKAKI_* variable, and the flag wins.
  const env = process.env;
  const ttsMode = values.tts ?? env.VIKAKI_TTS ?? "auto";
  if (!["auto", "kokoro", "chatterbox", "fake", "none"].includes(ttsMode)) {
    console.error(`${values.tts !== undefined ? "--tts" : "VIKAKI_TTS"} must be auto, kokoro, chatterbox, fake or none, not "${ttsMode}"`);
    process.exit(1);
  }
  const streaming = values.stream;
  const sizeMatch = /^(\d{2,5})x(\d{2,5})$/.exec(values.size!);
  const fps = Number(values.fps);
  const quality = Number(values.quality);
  const background = values.background === "green" ? "00b140" : values.background!;
  if (streaming) {
    const bad = !sizeMatch ? `--size must look like 1280x720, not "${values.size}"` : !(fps >= 1 && fps <= 60) ? `--fps must be 1 to 60, not "${values.fps}"` : !(quality >= 1 && quality <= 100) ? `--quality must be 1 to 100, not "${values.quality}"` : !/^[0-9a-f]{6}$/i.test(background) ? `--background must be 6 hex digits or "green", not "${values.background}"` : values["audio-only"] ? "--audio-only draws nothing, so there is nothing to stream" : undefined;
    if (bad) {
      console.error(bad);
      process.exit(1);
    }
  }
  if (!existsSync(values.static!)) {
    console.error(`no built page at ${values.static}; run \`pnpm build\` first`);
    process.exit(1);
  }
  let frameAncestors: string[] | undefined;
  try {
    const given = values["frame-ancestors"] ?? (env.VIKAKI_FRAME_ANCESTORS || undefined);
    frameAncestors = given !== undefined ? parseFrameAncestors(given) : undefined;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  let allowedHosts: string[] | undefined;
  try {
    const given = values["allow-host"] ?? (env.VIKAKI_ALLOWED_HOSTS || undefined);
    allowedHosts = given !== undefined ? parseAllowedHosts(given, values["allow-host"] !== undefined ? "--allow-host" : "VIKAKI_ALLOWED_HOSTS") : undefined;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const host = values.host!;
  const port = values.port !== undefined ? Number(values.port) : await findFreePort(8787, host);
  const phonemes = values.phonemes || ["1", "true", "on"].includes((env.VIKAKI_PHONEMES ?? "").toLowerCase());
  const chosen = await chooseTts(ttsMode, values.voice, phonemes).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
  const tts = chosen?.tts;
  const token = values.token ?? (env.VIKAKI_TOKEN || undefined);
  const debugArg = values["debug-dir"] ?? (values["speech-demo"] ? ".vikaki/debug" : undefined);
  const debugDir = debugArg && debugArg !== "off" && tts ? (values["debug-dir"] ? fromHere(debugArg) : resolve(debugArg)) : undefined;
  const recorder = debugDir
    ? new DebugRecorder({
        dir: debugDir,
        onSaved: (f) => console.log(`  debug: saved ${f}`),
        onError: (err) => console.error(`  debug: could not save a recording: ${err instanceof Error ? err.message : err}`),
      })
    : undefined;
  const personasFile = values.personas ?? (env.VIKAKI_PERSONAS || undefined);
  const personas = personasFile
    ? await loadPersonas(fromHere(personasFile)).catch((err) => {
        console.error(err instanceof PersonaError ? err.message : err);
        process.exit(1);
      })
    : undefined;
  const feed = streaming ? new MjpegFeed({ fps, token, allowedHosts }) : undefined;
  const eventLog = values["event-log"] ? new EventLog(fromHere(values["event-log"])) : undefined;
  const server = await startServer({
    staticDir: values.static!,
    port,
    host,
    personas,
    routes: feed ? { "/stream.mjpg": (req, res) => feed.handle(req, res), "/stream.jpg": (req, res) => feed.snapshot(req, res) } : undefined,
    frameAncestors,
    hub: { ...(token ? { token } : {}), ...(allowedHosts ? { allowedHosts } : {}), onEvent: eventLog?.record },
    speech: tts
      ? { tts, defaultVoice: chosen?.voice, observer: recorder, phonemes, onTiming: (t) => console.log(`  ${t.utterance_id}: first audio made ${t.firstAudioAt - t.textAt} ms after the text arrived`) }
      : undefined,
  });
  const url = values["speech-demo"] ? `${server.url}?demo=speech&live=1` : values.demo ? `${server.url}?demo=1&live=1` : `${server.url}?live=1`;
  console.log(`vikaki serving ${url}`);
  console.log(`  all the demos, as links: ${server.url.replace(/\/avatar$/, "/")}`);
  console.log(`  drivers connect to ${server.wsUrl}${token ? " (token required)" : ""}; speech: ${tts ? tts.name : "off"}`);
  if (phonemes && tts) console.log("  phonemes: sent with the audio (--phonemes)");
  console.log(`  framing: ${frameAncestors ? (frameAncestors.length ? frameAncestors.join(", ") : "no other page") : DEFAULT_FRAME_ANCESTORS.join(", ")} may embed the avatar page${frameAncestors ? "" : " (--frame-ancestors to change)"}`);
  let renderer: HeadlessRenderer | undefined;
  let stopCast: (() => Promise<void>) | undefined;
  if (values.headless || streaming) {
    try {
      if (values.chrome) process.env.VIKAKI_CHROME = values.chrome;
      renderer = await HeadlessRenderer.launch({
        // Listening on every interface (a container) is not an address to visit, and the hub answers only local names: go in by 127.0.0.1.
        pageUrl: server.url.replace(/\/\/(0\.0\.0\.0|\[::\]):/, "//127.0.0.1:"),
        personas: personas ? personas.names : [undefined],
        audioOnly: values["audio-only"],
        gpu: values.gpu,
        ...(streaming ? { size: { width: Number(sizeMatch![1]), height: Number(sizeMatch![2]) }, query: { bg: background } } : {}),
        onPageError: (message, who) => console.error(`  headless${who ? ` (${who})` : ""}: page error: ${message}`),
      });
      console.log(`  headless: ${values["audio-only"] ? "audio-only" : "rendering"} ${personas ? personas.names.join(", ") : "one page for every line"}`);
      if (feed) {
        const who = values["stream-persona"] ?? personas?.names[0];
        const page = renderer.pages.get(who);
        if (!page) throw new Error(`--stream-persona "${who}" is not one of: ${[...renderer.pages.keys()].join(", ")}`);
        stopCast = await startScreencast(page, { width: Number(sizeMatch![1]), height: Number(sizeMatch![2]), quality }, (jpeg) => feed.push(jpeg));
        console.log(`  stream: ${server.url.replace(/\/avatar$/, "")}/stream.mjpg  (${sizeMatch![1]}x${sizeMatch![2]}, ${fps} fps${who ? `, ${who}` : ""}; one frame: /stream.jpg${token ? "; add ?token=<your token>" : ""})`);
      }
    } catch (err) {
      await server.close();
      await tts?.close?.();
      console.error(err instanceof RendererUnavailable ? `cannot start the headless renderer: ${err.message}${process.env.VIKAKI_IMAGE === "vikaki" ? "\nThis is the small image, which has no browser: run the vikaki-render image instead." : ""}` : err);
      process.exit(1);
    }
  } else if (values["audio-only"] || values.gpu || values.chrome) {
    console.error("--audio-only, --gpu and --chrome only mean something with --headless (or stream)");
    await server.close();
    await tts?.close?.();
    process.exit(1);
  }
  if (values.port === undefined && port !== 8787) console.log(`(8787 was busy, using ${port})`);
  if (debugDir) console.log(`  debug recordings: ${debugDir}`);
  if (personas) console.log(`  personas: ${personas.names.join(", ")}`);
  if (eventLog) console.log(`  event log: ${fromHere(values["event-log"]!)}`);
  console.log("press Ctrl+C to stop");
  if (values.open) openBrowser(url);

  // Stop on purpose: say so, close the server, exit 0. A second Ctrl+C (or a hung close) forces the exit.
  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping...");
    await recorder?.flush();
    await stopCast?.().catch(() => {});
    feed?.close(); // viewers see the feed end, not a dead socket
    await renderer?.close().catch(() => {}); // the hidden browser first, so it does not see the hub vanish
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
    const { values } = parseArgs({ args: argv, options: { ...TARGET_OPTIONS, seat: { type: "string", multiple: true } } });
    const seats = (values.seat ?? []).map((s) => {
      const [seat_id, persona] = s.split(":");
      return { seat_id: seat_id!, ...(persona ? { persona } : {}) };
    });
    if (seats.some((s) => !/^[\w.-]+$/.test(s.seat_id) || new Set(seats.map((x) => x.seat_id)).size !== seats.length)) {
      console.error("--seat is an id such as seat-2, or seat-2:ada to name its persona; each seat once");
      return 1;
    }
    await runMcp(targetOf(values), seats.length ? seats : undefined); // stdout belongs to the protocol: anything human goes to stderr
    return 0;
  }
  if (command === "table-demo") {
    const { values } = parseArgs({ args: argv, options: { ...TARGET_OPTIONS, pace: { type: "string", default: "1" } } });
    const pace = Number(values.pace);
    if (!(pace >= 0)) {
      console.error("usage: vikaki table-demo [--pace N]   (N is 0 or more; 1 is as written, 0 skips the thinking pauses)");
      return 1;
    }
    return playHand({ ...targetOf(values), pace }, consoleIo);
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
  return (await replay({ ...targetOf(values), file: fromHere(positionals[0]), speed }, consoleIo)).code;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "serve") {
  await serve(rest);
} else if (command === "embed-demo") {
  await embedDemo(rest);
} else if (command === "stream") {
  await serve([...rest, "--stream"]);
} else if (command === "say" || command === "cancel" || command === "replay" || command === "mcp" || command === "table-demo") {
  process.exit(await clientCommand(command, rest));
} else if (command === "doctor") {
  const checks = await runDoctor(await realDoctorEnv());
  console.log(formatChecks(checks));
  process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
} else {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
