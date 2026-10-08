import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { Hub, type HubOptions } from "./hub.ts";
import { SpeechEngine, type SpeechOptions } from "./speech.ts";

export { Hub, type HubEvent, type HubOptions } from "./hub.ts";
export { SpeechEngine, type SpeechObserver, type SpeechOptions, type SpeechTiming } from "./speech.ts";
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
  const speech = opts.speech ? new SpeechEngine(opts.speech) : undefined;
  const hub = new Hub(server, {
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
