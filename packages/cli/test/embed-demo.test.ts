import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const children: ChildProcess[] = [];
afterEach(() => children.splice(0).forEach((c) => c.kill("SIGINT")));

/** Start `vikaki embed-demo --tts fake` on free ports and say where the page is. */
async function start(extra: string[] = []): Promise<{ host: string; hub: string; out: () => string }> {
  // Any folder will do as the hub's page: CI's unit job does not build the real one.
  const pageDir = await mkdtemp(join(tmpdir(), "vikaki-embed-demo-page-"));
  await writeFile(join(pageDir, "index.html"), "hi");
  const child = spawn(process.execPath, ["--import", "tsx", entry, "embed-demo", "--tts", "fake", "--static", pageDir, ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 300 && !out.includes("Ctrl+C"); i++) await new Promise((r) => setTimeout(r, 100));
  const host = /open (http:\/\/127\.0\.0\.1:\d+)/.exec(out)?.[1];
  const hub = /frames the hub's avatar page \((http:\/\/127\.0\.0\.1:\d+)\)/.exec(out)?.[1];
  if (!host || !hub) throw new Error(`the demo did not start: ${out}`);
  return { host, hub, out: () => out };
}

describe("vikaki embed-demo", () => {
  it("serves a host page that frames the duet layout of a hub on another port, and lets the hub be framed by it only", async () => {
    const { host, hub } = await start();
    expect(host).not.toBe(hub);
    const html = await (await fetch(host)).text();
    expect(html).toContain(`${hub}/avatar?seats=2&embed=1&layout=duet&hud=0&parent=${encodeURIComponent(host)}`);
    expect(html).toContain('allow="autoplay"');
    const csp = (await fetch(`${hub}/avatar`)).headers.get("content-security-policy");
    expect(csp).toBe(`frame-ancestors 'self' ${host}`);
    expect((await fetch(`${hub}/avatar?parent=${encodeURIComponent(host)}`)).status).toBe(200);
    expect((await fetch(`${hub}/avatar?parent=${encodeURIComponent("http://127.0.0.1:1")}`)).status).toBe(403);
  }, 60_000);

  it("speaks a line for a seat through its own driver, and reports it back; refuses a bad request", async () => {
    const { host } = await start();
    const events = await fetch(`${host}/events`);
    const reader = events.body!.getReader();
    const post = (path: string, body: unknown) => fetch(`${host}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("/say", { seat: "seat-3", text: "hi" })).status).toBe(400);
    expect((await post("/say", { seat: "seat-1", text: "" })).status).toBe(400);
    expect((await post("/say", { seat: "seat-2", text: "Warm, maybe sixty." })).status).toBe(204);
    let seen = "";
    const decoder = new TextDecoder();
    for (let i = 0; i < 100 && !/seat-2: speech_finished/.test(seen); i++) {
      const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((ok) => setTimeout(() => ok({ value: undefined, done: true }), 15_000))]);
      if (done) break;
      seen += decoder.decode(value);
    }
    expect(seen).toMatch(/seat-2: speech_started/);
    expect(seen).toMatch(/seat-2: speech_finished/);
    expect(seen).not.toMatch(/seat-1/);
    await reader.cancel();
  }, 60_000);

  it("refuses two equal ports, and does not start", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", entry, "embed-demo", "--port", "9000", "--hub-port", "9000"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const code = await new Promise((ok) => child.once("exit", ok));
    expect(code).toBe(1);
    expect(err).toMatch(/two different ports/);
  }, 30_000);
});
