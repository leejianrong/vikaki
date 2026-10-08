import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findFreePort, startServer, type RunningServer } from "../src/server.ts";

let dir: string;
let running: RunningServer | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-static-"));
  await writeFile(join(dir, "index.html"), "<title>vikaki avatar</title>");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "a.js"), "console.log(1)");
});

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("avatar server", () => {
  it("serves the avatar page with HTTP 200", async () => {
    running = await startServer({ staticDir: dir });
    const res = await fetch(running.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("vikaki avatar");
  });

  it("serves assets under /avatar/", async () => {
    running = await startServer({ staticDir: dir });
    const res = await fetch(`${running.url}/assets/a.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("rejects path traversal", async () => {
    running = await startServer({ staticDir: dir });
    const res = await fetch(`http://127.0.0.1:${running.port}/avatar/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(res.status);
  });

  it("shuts down cleanly", async () => {
    running = await startServer({ staticDir: dir });
    const { port } = running;
    await running.close();
    running = undefined;
    await expect(fetch(`http://127.0.0.1:${port}/avatar`)).rejects.toThrow();
  });
});

describe("findFreePort", () => {
  it("returns the start port when it is free", async () => {
    const probe = await startServer({ staticDir: dir });
    const busy = probe.port;
    await probe.close();
    expect(await findFreePort(busy)).toBe(busy);
  });

  it("skips a port that is in use", async () => {
    running = await startServer({ staticDir: dir });
    const next = await findFreePort(running.port);
    expect(next).toBeGreaterThan(running.port);
  });

  it("throws when nothing is free in range", async () => {
    running = await startServer({ staticDir: dir });
    await expect(findFreePort(running.port, "127.0.0.1", 1)).rejects.toThrow(/no free port/);
  });
});
