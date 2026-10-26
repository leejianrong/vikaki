import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make, PROTOCOL_VERSION } from "@vikaki/protocol";

// These build the real images and start real containers, which takes minutes, so they run only when asked:
//   VIKAKI_DOCKER_TESTS=1 pnpm --filter @vikaki/e2e exec vitest run docker      (or `make docker-test`; CI runs them in docker.yml)
const enabled = process.env.VIKAKI_DOCKER_TESTS === "1";
const run = promisify(execFile);
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const hasFfprobe = await run("ffprobe", ["-version"]).then(() => true, () => false);

const docker = async (...args: string[]) => (await run("docker", args, { cwd: repo, maxBuffer: 50 * 1024 * 1024, timeout: 25 * 60_000 })).stdout.trim();

const containers: string[] = [];
afterAll(async () => {
  for (const c of containers) await docker("rm", "-f", c).catch(() => {});
});

/** Start a container, publishing 8787 on a free port of the host's loopback only. Returns the port and when it started. */
async function start(image: string, args: string[] = [], env: Record<string, string> = {}) {
  const id = await docker("run", "-d", "-p", "127.0.0.1::8787", ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), image, ...args);
  containers.push(id);
  const startedAt = Date.now();
  const mapping = await docker("port", id, "8787/tcp");
  const port = Number(/:(\d+)\s*$/m.exec(mapping.split("\n")[0]!)![1]);
  return { id, port, startedAt };
}

/** Seconds until Docker's health check says healthy (it runs the check inside the container). */
async function healthy(id: string, startedAt: number, limitMs = 60_000): Promise<number> {
  for (;;) {
    const status = await docker("inspect", "-f", "{{.State.Health.Status}}", id);
    if (status === "healthy") return (Date.now() - startedAt) / 1000;
    if (status === "unhealthy" || Date.now() - startedAt > limitMs) throw new Error(`container is ${status}; logs:\n${await docker("logs", id).catch(() => "")}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

type Msg = Record<string, unknown> & { type: string };
/** Be a driver from outside the container: send one line, return what the hub reported back. */
async function say(port: number, text: string): Promise<{ started: Msg; finished: Msg }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const events: Msg[] = [];
  ws.on("message", (d) => events.push(JSON.parse(d.toString())));
  await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
  ws.send(JSON.stringify(make("hello", { role: "driver" })));
  const wait = async (pred: (m: Msg) => boolean) => {
    const end = Date.now() + 60_000;
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`timed out; saw ${events.map((e) => e.type).join(",")}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  await wait((m) => m.type === "welcome");
  ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: "u1", text }));
  const started = await wait((m) => m.type === "speech_started");
  const finished = await wait((m) => m.type === "speech_finished");
  ws.close();
  return { started, finished };
}

describe.skipIf(!enabled)("the small image (target vikaki)", () => {
  it("builds, runs as a non-root user, exposes only the documented port, and is healthy within 10 s", { timeout: 30 * 60_000 }, async () => {
    await docker("build", "--target", "vikaki", "-t", "vikaki:test", ".");
    expect(await docker("inspect", "-f", "{{.Config.User}}", "vikaki:test")).toBe("node");
    expect(JSON.parse(await docker("inspect", "-f", "{{json .Config.ExposedPorts}}", "vikaki:test"))).toEqual({ "8787/tcp": {} });
    const c = await start("vikaki:test");
    expect(await docker("exec", c.id, "id", "-u")).not.toBe("0");
    const seconds = await healthy(c.id, c.startedAt);
    expect(seconds, `healthy after ${seconds.toFixed(1)} s`).toBeLessThan(10);
  });

  it("serves the avatar page and lets a driver outside the container make it speak", { timeout: 10 * 60_000 }, async () => {
    const c = await start("vikaki:test");
    await healthy(c.id, c.startedAt);
    const page = await fetch(`http://127.0.0.1:${c.port}/avatar`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<canvas");
    const { finished } = await say(c.port, "Hello from outside the container.");
    expect(finished.utterance_id).toBe("u1"); // the hub kept time itself: no page was open
  });

  it("is configured by environment variables alone: the default command, no flags (VIK-126)", { timeout: 10 * 60_000 }, async () => {
    const c = await start("vikaki:test", [], { VIKAKI_TTS: "none", VIKAKI_TOKEN: "s3cret", VIKAKI_FRAME_ANCESTORS: "https://game.example" });
    await healthy(c.id, c.startedAt);
    const logs = (await run("docker", ["logs", c.id])).stdout;
    expect(logs).toContain("(token required); speech: off");
    expect(logs).toContain("framing: https://game.example may embed the avatar page");
    expect((await fetch(`http://127.0.0.1:${c.port}/avatar/?parent=https://game.example`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${c.port}/avatar/?parent=https://other.example`)).status).toBe(403);
    expect(logs).not.toContain("s3cret");
  });

  it("sends the phonemes of a line when started with VIKAKI_PHONEMES=1: the dictionary is in the image (VIK-50)", { timeout: 10 * 60_000 }, async () => {
    const c = await start("vikaki:test", [], { VIKAKI_TTS: "fake", VIKAKI_PHONEMES: "1" });
    await healthy(c.id, c.startedAt);
    const ws = new WebSocket(`ws://127.0.0.1:${c.port}/ws`);
    const heard: Msg[] = [];
    ws.on("message", (d) => heard.push(JSON.parse(d.toString())));
    await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
    ws.send(JSON.stringify(make("hello", { role: "viewer" })));
    // A viewer that never reports back is enough: the audio is sent to it as soon as it is made.
    const driver = new WebSocket(`ws://127.0.0.1:${c.port}/ws`);
    await new Promise((ok, fail) => (driver.once("open", ok), driver.once("error", fail)));
    driver.send(JSON.stringify(make("hello", { role: "driver" })));
    driver.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: "utterance", seat_id: "seat-1", utterance_id: "ph1", text: "Hello there, my friend." }));
    for (const end = Date.now() + 30_000; !heard.some((m) => m.type === "audio" && m.final === true); ) {
      if (Date.now() > end) throw new Error(`timed out; saw ${heard.map((m) => m.type).join(",")}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    driver.close();
    ws.close();
    const withPhonemes = heard.filter((m) => m.type === "audio" && Array.isArray(m.phonemes));
    expect(withPhonemes.length).toBeGreaterThan(0);
    const spans = withPhonemes[0]!.phonemes as { p: string; t: number; d: number }[];
    expect(spans.length).toBeGreaterThan(8);
    expect(spans.map((s) => s.p).join("")).toContain("l"); // sounds of the words, not an empty guess
  });

  it("answers a listed Host name such as vikaki:8787 and still refuses other names (VIK-127)", { timeout: 10 * 60_000 }, async () => {
    const plain = await start("vikaki:test");
    const listed = await start("vikaki:test", [], { VIKAKI_ALLOWED_HOSTS: "vikaki:8787" });
    await healthy(plain.id, plain.startedAt);
    await healthy(listed.id, listed.startedAt);
    const open = (port: number, host: string) =>
      new Promise<string>((ok) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: host } });
        ws.once("open", () => (ws.close(), ok("open")));
        ws.once("unexpected-response", (_req, res) => ok(String(res.statusCode)));
        ws.once("error", () => ok("error"));
      });
    expect(await open(plain.port, "vikaki:8787")).toBe("403");
    expect(await open(listed.port, "vikaki:8787")).toBe("open");
    expect(await open(listed.port, "evil.example")).toBe("403");
  });

  it("loads a game's own personas file from a mounted /data, naming a bundled avatar and its own (VIK-131)", { timeout: 10 * 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-personas-"));
    await copyFile(join(repo, "packages/engine/public/avatars/snowy.vrm"), join(dir, "mine.vrm"));
    await writeFile(join(dir, "personas.yaml"), "version: 1\npersonas:\n  bundled:\n    avatar: /app/avatars/cookieman.vrm\n    emotion: happy\n  mine:\n    avatar: mine.vrm\n    voice: af_heart\n");
    await chmod(dir, 0o755);
    await Promise.all(["mine.vrm", "personas.yaml"].map((f) => chmod(join(dir, f), 0o644)));
    const id = await docker("run", "-d", "-p", "127.0.0.1::8787", "-v", `${dir}:/data:ro`, "-e", "VIKAKI_PERSONAS=/data/personas.yaml", "vikaki:test");
    containers.push(id);
    const startedAt = Date.now();
    await healthy(id, startedAt);
    const port = Number(/:(\d+)\s*$/m.exec((await docker("port", id, "8787/tcp")).split("\n")[0]!)![1]);
    const list = (await (await fetch(`http://127.0.0.1:${port}/avatar/personas.json`)).json()) as { personas?: { name: string }[] } | { name: string }[];
    const names = (Array.isArray(list) ? list : (list.personas ?? [])).map((p) => p.name);
    expect(names).toEqual(["bundled", "mine"]);
    for (const n of names) expect((await fetch(`http://127.0.0.1:${port}/avatar/personas/${n}.vrm`)).status, n).toBe(200);
  });

  it("refuses a browser from another site, so publishing the port does not open it to the web", { timeout: 10 * 60_000 }, async () => {
    const c = await start("vikaki:test");
    await healthy(c.id, c.startedAt);
    const refused = await new Promise<boolean>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${c.port}/ws`, { headers: { Origin: "https://evil.example" } });
      ws.once("open", () => ok(false));
      ws.once("unexpected-response", () => ok(true));
      ws.once("error", () => ok(true));
    });
    expect(refused).toBe(true);
  });
});

describe.skipIf(!enabled)("the image with a browser (target vikaki-render)", () => {
  it("renders with no GPU: `stream` starts, a driver's line is drawn by the hidden page, and the feed has the size asked for", { timeout: 40 * 60_000 }, async () => {
    await docker("build", "--target", "vikaki-render", "-t", "vikaki-render:test", ".");
    expect(await docker("inspect", "-f", "{{.Config.User}}", "vikaki-render:test")).toBe("node");
    const c = await start("vikaki-render:test", ["stream", "--host", "0.0.0.0", "--port", "8787", "--size", "480x270", "--fps", "10"]);
    await healthy(c.id, c.startedAt, 120_000);
    // the hidden page connects after the server is up; a line reaches it only once it has
    let finished: Msg | undefined;
    for (let attempt = 0; attempt < 30 && !finished; attempt++) {
      const heard = await say(c.port, "x".repeat(30));
      if ((heard.finished.timing as { frame_ms?: number } | undefined)?.frame_ms !== undefined) finished = heard.finished;
      else await new Promise((r) => setTimeout(r, 1000));
    }
    expect(finished, "a line drawn by the page in the container should report frame_ms").toBeDefined();
    if (hasFfprobe) {
      const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", "-analyzeduration", "3000000", "-probesize", "2000000", `http://127.0.0.1:${c.port}/stream.mjpg`], { timeout: 30_000 });
      expect(JSON.parse(stdout).streams[0]).toMatchObject({ codec_name: "mjpeg", width: 480, height: 270 });
    }
  });

  it("says how to fix it, instead of failing mysteriously, when asked to render in the small image", { timeout: 10 * 60_000 }, async () => {
    const out = await docker("run", "--rm", "vikaki:test", "serve", "--port", "8787", "--headless").catch((e: { stderr?: string; stdout?: string }) => `${e.stdout ?? ""}${e.stderr ?? ""}`);
    expect(out).toMatch(/cannot start the headless renderer/);
    expect(out).toMatch(/make install-renderer|vikaki-render/);
  });
});

// The compose example (VIK-128): a stand-in game and the hub on a compose network, on free loopback ports, under their own project name.
describe.skipIf(!enabled)("the compose example (examples/compose)", () => {
  const project = `vikaki-compose-test-${process.pid}`;
  const file = join(repo, "examples/compose/docker-compose.yml");
  const compose = (...args: string[]) => run("docker", ["compose", "-p", project, "-f", file, ...args], { cwd: repo, timeout: 25 * 60_000, maxBuffer: 50 * 1024 * 1024, env: { ...process.env, VIKAKI_PORT: String(hubPort), GAME_PORT: String(gamePort) } });
  const hubPort = 20000 + (process.pid % 10000);
  const gamePort = hubPort + 1;
  afterAll(async () => {
    await compose("down", "-v", "--remove-orphans").catch(() => {});
  });

  it("brings up a game and the hub: the game's line is spoken through the hub, framing and Host rules hold", { timeout: 30 * 60_000 }, async () => {
    await compose("up", "-d", "--build", "--wait", "--wait-timeout", "180");
    const logs = (await compose("logs", "game")).stdout;
    expect(logs).toContain("connected to ws://vikaki:8787/ws");
    expect(logs).toMatch(/said .*speech_finished/);
    expect((await fetch(`http://127.0.0.1:${gamePort}/`)).status).toBe(200);
    const hub = `http://127.0.0.1:${hubPort}`;
    expect((await fetch(`${hub}/avatar/?parent=http://127.0.0.1:${gamePort}`)).status).toBe(200);
    expect((await fetch(`${hub}/avatar/?parent=https://other.example`)).status).toBe(403);
    const hostRefused = await new Promise<boolean>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${hubPort}/ws`, { headers: { Host: "evil.example" } });
      ws.once("open", () => ok(false));
      ws.once("unexpected-response", () => ok(true));
      ws.once("error", () => ok(true));
    });
    expect(hostRefused).toBe(true);
    const published = (await run("docker", ["compose", "-p", project, "-f", file, "ps", "--format", "{{.Ports}}"], { cwd: repo, env: { ...process.env, VIKAKI_PORT: String(hubPort), GAME_PORT: String(gamePort) } })).stdout;
    expect(published).not.toMatch(/0\.0\.0\.0:/);
  });
});

// The real voice in a container (VIK-130). The build installs Kokoro and its model and makes it speak once; this checks a running container does too.
describe.skipIf(!enabled)("the image with the real voice (target vikaki-kokoro)", () => {
  it("speaks one line with Kokoro, with no download at start", { timeout: 40 * 60_000 }, async () => {
    await docker("build", "--target", "vikaki-kokoro", "-t", "vikaki-kokoro:test", ".");
    const c = await start("vikaki-kokoro:test");
    const seconds = await healthy(c.id, c.startedAt);
    expect(seconds).toBeLessThan(30);
    const { started, finished } = await say(c.port, "Hello from inside the container.");
    expect(started.utterance_id).toBe(finished.utterance_id);
    const logs = (await run("docker", ["logs", c.id])).stdout;
    expect(logs).toMatch(/speech: kokoro/);
    expect(logs).toMatch(/first audio made \d+ ms after the text arrived/);
    expect(logs).not.toMatch(/test voice|steady "aah"|fake/i);
  });
});
