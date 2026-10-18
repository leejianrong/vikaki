import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { frameAncestorAllowed, frameAncestorsPolicy } from "./frame-ancestors.ts";
export { parseFrameAncestors, DEFAULT_FRAME_ANCESTORS } from "./frame-ancestors.ts";
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
  /**
   * Origins whose pages may frame the avatar page: bare origins such as `http://127.0.0.1:8765`. Not set, it is localhost on any port. An
   * empty list lets nobody (the page itself still can). Sent as `Content-Security-Policy: frame-ancestors`, so the browser enforces it.
   */
  frameAncestors?: string[];
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
        // The landing page (VIK-117): the build's home.html, so nobody has to remember a URL with parameters. A build without one goes to the avatar.
        const home = await readFile(join(root, "home.html")).catch(() => undefined);
        if (home) res.writeHead(200, { "content-type": MIME[".html"]! }).end(home);
        else res.writeHead(302, { location: "/avatar" }).end();
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
          ...(p.pose ? { pose: p.pose } : {}),
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
      const framing = { "content-security-policy": frameAncestorsPolicy(opts.frameAncestors) };
      // A page that says who frames it (`?parent=`, which turns on its messages to that page) names one the list allows, or it is not served:
      // a typo or a stale origin fails here, loudly, instead of by silence in the browser.
      const parent = new URL(req.url ?? "/", "http://localhost").searchParams.get("parent");
      if (rel === "index.html" && parent !== null && !frameAncestorAllowed(parent, opts.frameAncestors)) {
        res.writeHead(403, { "content-type": "text/plain", ...framing }).end(`parent=${parent} is not an allowed frame ancestor. Start the hub with --frame-ancestors ${parent} (a bare origin such as http://127.0.0.1:8765).`);
        return;
      }
      const file = normalize(join(root, rel));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", ...framing });
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
    onDriverGone: (ids) => {
      opts.hub?.onDriverGone?.(ids);
      speech?.driverGone(ids);
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
