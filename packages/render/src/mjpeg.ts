import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const BOUNDARY = "vikakiframe";

export interface MjpegOptions {
  /** How often the latest frame is sent to each viewer, whether or not a new one has arrived. */
  fps: number;
  /** If set, a viewer must give it as `?token=`. */
  token?: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest();

/** The same rule as the hub's: only local names, so a web page cannot reach the feed through DNS rebinding. */
function localHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return ["127.0.0.1", "localhost", "[::1]"].includes(hostname ?? "");
}

/**
 * An MJPEG feed over HTTP (`multipart/x-mixed-replace`), the simplest video other programs can open: VLC, ffplay, OBS's
 * media source, a browser `<img>`. Push JPEG frames in; every viewer gets the latest one at a steady rate.
 */
export class MjpegFeed {
  private latest?: Buffer;
  private readonly clients = new Set<ServerResponse>();
  private timer?: ReturnType<typeof setInterval>;
  /** Frames pushed so far. */
  frames = 0;

  constructor(private readonly o: MjpegOptions) {}

  get viewers(): number {
    return this.clients.size;
  }

  /** The newest picture. Viewers see it at the next tick. */
  push(jpeg: Buffer): void {
    this.latest = jpeg;
    this.frames++;
  }

  private refuse(req: IncomingMessage, res: ServerResponse): boolean {
    if (!localHost(req)) {
      res.writeHead(403).end("unexpected Host header");
      return true;
    }
    if (this.o.token !== undefined) {
      const given = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
      if (given === null || !timingSafeEqual(sha(given), sha(this.o.token))) {
        res.writeHead(401).end("a token is required: add ?token=...");
        return true;
      }
    }
    return false;
  }

  /** Serve the endless stream to one viewer. */
  handle(req: IncomingMessage, res: ServerResponse): void {
    if (this.refuse(req, res)) return;
    res.writeHead(200, {
      "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "cache-control": "no-store",
      connection: "close",
      pragma: "no-cache",
    });
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
      if (this.clients.size === 0 && this.timer) (clearInterval(this.timer), (this.timer = undefined));
    });
    this.timer ??= setInterval(() => this.tick(), Math.max(1, Math.round(1000 / this.o.fps)));
    this.timer.unref?.();
  }

  /** The latest frame as a single JPEG, or 503 if there is none yet. */
  snapshot(req: IncomingMessage, res: ServerResponse): void {
    if (this.refuse(req, res)) return;
    if (!this.latest) return void res.writeHead(503, { "retry-after": "1" }).end("no frame yet");
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": this.latest.length, "cache-control": "no-store" }).end(this.latest);
  }

  /** Send the latest frame to every viewer that can take it. A viewer whose connection is full is skipped, never queued behind. */
  tick(): void {
    const jpeg = this.latest;
    if (!jpeg) return;
    const part = Buffer.concat([Buffer.from(`--${BOUNDARY}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`), jpeg, Buffer.from("\r\n")]);
    for (const res of this.clients) {
      if (res.writableNeedDrain || !res.writable) continue;
      res.write(part);
    }
  }

  /** End every viewer's stream. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
