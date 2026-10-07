import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";

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
}

export interface RunningServer {
  url: string;
  port: number;
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

  return {
    url: `http://${host}:${port}/avatar`,
    port,
    close: () =>
      new Promise<void>((ok, fail) => {
        server.close((err) => (err ? fail(err) : ok()));
        server.closeAllConnections();
      }),
  };
}
