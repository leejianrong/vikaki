import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { Hub, type HubOptions } from "./hub.ts";
import type { PersonaBook } from "./personas.ts";
import { SpeechEngine, type SpeechOptions } from "./speech.ts";

export { Hub, type HubEvent, type HubOptions } from "./hub.ts";
export { SpeechEngine, type SpeechObserver, type SpeechOptions, type SpeechTiming } from "./speech.ts";
export { EventLog, readEventLog, type LoggedEvent } from "./event-log.ts";
export { loadPersonas, parsePersonas, PersonaBook, PersonaError, type Persona } from "./personas.ts";
export { DebugRecorder, spectrogramPng } from "./debug/index.ts";
export { analyse, classify, decodeWav, encodeWav, type SpeechMetrics, type Verdict } from "@vikaki/audio";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".vrm": "model/gltf-binary",
  ".glb": "model/gltf-binary",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export interface VikakiServerOptions {
  /** Directory holding the built avatar page (the engine's `dist`). */
  staticDir: string;
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Options for the WebSocket hub at /ws. */
  hub?: HubOptions;
  /** Named characters from a personas file: validates `persona` on lines, picks their voice and default emotion, and serves their avatars. */
  personas?: PersonaBook;
  /** Extra exact-path routes served before the avatar page, such as the MJPEG feed. Each does its own access checks. */
  routes?: Record<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>;
  /** Turn on speech: utterances from the driver are spoken with this engine. */
  speech?: SpeechOptions;
}

export interface RunningServer {
  url: string;
  /** WebSocket address of the hub. */
  wsUrl: string;
  port: number;
  hub: Hub;
  speech?: SpeechEngine;
  close(): Promise<void>;
}

export async function startServer(opts: VikakiServerOptions): Promise<RunningServer> {
  const root = resolve(opts.staticDir);
  const host = opts.host ?? "127.0.0.1";

  const server: Server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/") {
        res.writeHead(302, { location: "/avatar" }).end();
        return;
      }
      const route = opts.routes?.[path];
      if (route) {
        await route(req, res);
        return;
      }
      if (path === "/avatar/personas.json") {
        const list = (opts.personas?.list() ?? []).map((p) => ({
          name: p.name,
          avatarUrl: `/avatar/personas/${encodeURIComponent(p.name)}.vrm`,
          ...(p.voice ? { voice: p.voice } : {}),
          ...(p.emotion ? { emotion: p.emotion } : {}),
          ...(p.style ? { style: p.style } : {}),
        }));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
        return;
      }
      if (path.startsWith("/avatar/personas/") && path.endsWith(".vrm")) {
        // Looked up by name in the personas file, never as a path, so only the avatars the file names can be fetched.
        const name = decodeURIComponent(path.slice("/avatar/personas/".length, -".vrm".length));
        const persona = opts.personas?.get(name);
        if (!persona) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "content-type": "model/gltf-binary" }).end(await readFile(persona.avatar));
        return;
      }
      if (path !== "/avatar" && !path.startsWith("/avatar/")) {
        res.writeHead(404).end("not found");
        return;
      }
      const rel = path.slice("/avatar".length).replace(/^\/+/, "") || "index.html";
      const file = normalize(join(root, rel));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, host, ok);
  });
  const port = (server.address() as AddressInfo).port;
  // With a personas file, a persona's voice comes from the file (the engine's own voice if it names none), not from its name.
  const speechOptions: SpeechOptions | undefined = opts.speech && opts.personas ? { ...opts.speech, voiceFor: (p) => (p ? opts.personas!.get(p)?.voice : undefined) } : opts.speech;
  const speech = speechOptions ? new SpeechEngine(speechOptions) : undefined;
  const hub = new Hub(server, {
    personas: opts.personas,
    speechName: opts.speech ? opts.speech.tts.name : "off",
    speechVoice: opts.speech?.defaultVoice,
    ...opts.hub,
    onDriverMessage: (m) => {
      opts.hub?.onDriverMessage?.(m);
      speech?.handle(m);
    },
    onDriverGone: () => {
      opts.hub?.onDriverGone?.();
      speech?.driverGone();
    },
  });
  speech?.attach(hub);

  return {
    url: `http://${host}:${port}/avatar`,
    wsUrl: `ws://${host}:${port}/ws`,
    port,
    hub,
    speech,
    close: async () => {
      await hub.close();
      await new Promise<void>((ok, fail) => {
        server.close((err) => (err ? fail(err) : ok()));
        server.closeAllConnections();
      });
    },
  };
}

/** First port at or above `start` that can be bound on `host`. Pure stdlib, no lsof or nc. */
export async function findFreePort(start: number, host = "127.0.0.1", attempts = 50): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    const free = await new Promise<boolean>((ok) => {
      const probe = createNetServer();
      probe.once("error", () => ok(false));
      probe.listen(port, host, () => probe.close(() => ok(true)));
    });
    if (free) return port;
  }
  throw new Error(`no free port in ${start}..${start + attempts - 1}`);
}
