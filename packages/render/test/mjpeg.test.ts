import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MjpegFeed } from "../src/mjpeg.ts";

// Three tiny "JPEGs": real JPEGs start FFD8 and end FFD9, which is all the feed relies on.
const jpeg = (tag: number) => Buffer.from([0xff, 0xd8, tag, tag, tag, 0xff, 0xd9]);

let server: Server | undefined;
let feed: MjpegFeed | undefined;
afterEach(async () => {
  feed?.close();
  await new Promise<void>((ok) => (server ? server.close(() => ok()) : ok()));
  server = undefined;
  feed = undefined;
});

async function serve(options: ConstructorParameters<typeof MjpegFeed>[0]) {
  feed = new MjpegFeed(options);
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/stream.mjpg") feed!.handle(req, res);
    else if (path === "/stream.jpg") feed!.snapshot(req, res);
    else res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Read an MJPEG stream and parse its parts, until `count` frames have arrived. */
function readFrames(url: string, count: number, headers: Record<string, string> = {}): Promise<{ status: number; type: string; frames: Buffer[] }> {
  return new Promise((ok, fail) => {
    const req = request(url, { headers }, (res) => {
      const frames: Buffer[] = [];
      let buf = Buffer.alloc(0);
      res.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          const head = buf.indexOf("\r\n\r\n");
          if (head < 0) break;
          const length = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, head).toString())?.[1]);
          if (!length || buf.length < head + 4 + length) break;
          frames.push(Buffer.from(buf.subarray(head + 4, head + 4 + length)));
          buf = buf.subarray(head + 4 + length);
          if (frames.length >= count) {
            req.destroy();
            ok({ status: res.statusCode!, type: String(res.headers["content-type"]), frames });
          }
        }
      });
      if (res.statusCode !== 200) ok({ status: res.statusCode!, type: String(res.headers["content-type"]), frames });
    });
    req.on("error", (e) => (frames_done ? undefined : fail(e)));
    req.end();
    let frames_done = false;
    setTimeout(() => ((frames_done = true), fail(new Error("timed out waiting for frames"))), 5000).unref();
  });
}

describe("MjpegFeed", () => {
  it("serves multipart/x-mixed-replace parts, each with its own length and the frame's bytes", async () => {
    const url = await serve({ fps: 30 });
    feed!.push(jpeg(1));
    const r = await readFrames(`${url}/stream.mjpg`, 2);
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/^multipart\/x-mixed-replace; boundary=/);
    expect(r.frames[0]).toEqual(jpeg(1));
  });

  it("keeps sending the latest frame at the chosen rate even when nothing new arrives, so players do not stall", async () => {
    const url = await serve({ fps: 50 });
    feed!.push(jpeg(7));
    const started = Date.now();
    const r = await readFrames(`${url}/stream.mjpg`, 5);
    expect(r.frames.every((f) => f.equals(jpeg(7)))).toBe(true);
    expect(Date.now() - started).toBeGreaterThan(50); // five frames took about four intervals
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("shows a new frame as soon as it is the latest", async () => {
    const url = await serve({ fps: 50 });
    feed!.push(jpeg(1));
    const reading = readFrames(`${url}/stream.mjpg`, 60);
    setTimeout(() => feed!.push(jpeg(2)), 120);
    const r = await reading;
    const firstTwo = r.frames.findIndex((f) => f.equals(jpeg(2)));
    expect(firstTwo).toBeGreaterThan(0);
    expect(r.frames.slice(firstTwo).every((f) => f.equals(jpeg(2)))).toBe(true);
  });

  it("waits for the first frame before sending anything, rather than sending an empty part", async () => {
    const url = await serve({ fps: 50 });
    const reading = readFrames(`${url}/stream.mjpg`, 1);
    await new Promise((r) => setTimeout(r, 150));
    feed!.push(jpeg(3));
    expect((await reading).frames[0]).toEqual(jpeg(3));
  });

  it("answers /stream.jpg with the latest frame, or 503 before there is one", async () => {
    const url = await serve({ fps: 30 });
    expect((await fetch(`${url}/stream.jpg`)).status).toBe(503);
    feed!.push(jpeg(9));
    const res = await fetch(`${url}/stream.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg(9));
  });

  it("counts viewers, and forgets one that goes away", async () => {
    const url = await serve({ fps: 30 });
    feed!.push(jpeg(1));
    expect(feed!.viewers).toBe(0);
    const req = request(`${url}/stream.mjpg`);
    req.on("error", () => {});
    req.end();
    const end = Date.now() + 2000;
    while (feed!.viewers < 1 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(feed!.viewers).toBe(1);
    req.destroy();
    while (feed!.viewers > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(feed!.viewers).toBe(0);
  });

  it("does not buffer for a client that cannot keep up: it skips frames instead", () => {
    feed = new MjpegFeed({ fps: 1000 });
    const written: Buffer[] = [];
    const fakeRes = {
      writable: true,
      writableNeedDrain: true, // the socket is full
      writeHead: () => fakeRes,
      write: (b: Buffer | string) => (written.push(Buffer.from(b)), false),
      on: () => fakeRes,
      end: () => {},
    };
    feed.push(jpeg(1));
    feed.handle({ headers: { host: "127.0.0.1" }, on: () => {} } as never, fakeRes as never);
    const before = written.length;
    feed.push(jpeg(2));
    feed.tick();
    feed.tick();
    expect(written.length).toBe(before); // nothing more was queued behind a full socket
  });

  it("refuses a Host that is not a local name (DNS rebinding), and a missing or wrong token when one is set", async () => {
    const url = await serve({ fps: 30, token: "s3" });
    feed!.push(jpeg(1));
    expect((await readFrames(`${url}/stream.mjpg`, 1)).status).toBe(401); // no token
    expect((await readFrames(`${url}/stream.mjpg?token=wrong`, 1)).status).toBe(401);
    expect((await readFrames(`${url}/stream.mjpg?token=s3`, 1)).status).toBe(200);
    const evil = await readFrames(`${url}/stream.mjpg?token=s3`, 1, { Host: "evil.example" });
    expect(evil.status).toBe(403);
  });

  it("ends every viewer's stream when closed", async () => {
    const url = await serve({ fps: 30 });
    feed!.push(jpeg(1));
    const ended = new Promise<void>((ok) => {
      const req = request(`${url}/stream.mjpg`, (res) => res.on("end", ok).on("close", ok).resume());
      req.on("error", () => ok());
      req.end();
    });
    await new Promise((r) => setTimeout(r, 100));
    feed!.close();
    await ended;
    expect(feed!.viewers).toBe(0);
  });
});
