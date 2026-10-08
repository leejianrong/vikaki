import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const pageDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

/** Run `vikaki serve ...` until `done` is true of what it has printed (or it exits); stops it with SIGINT. */
function run(args: string[], done: (out: string) => boolean) {
  const child = spawn(process.execPath, ["--import", "tsx", entry, "serve", "--tts", "fake", "--static", pageDir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  return new Promise<{ code: number | null; out: string; err: string }>((ok) => {
    const timer = setTimeout(() => child.kill("SIGINT"), 20_000);
    const poll = setInterval(() => done(out) && child.kill("SIGINT"), 100);
    child.once("exit", (code) => {
      clearTimeout(timer);
      clearInterval(poll);
      ok({ code, out, err });
    });
  });
}

describe("vikaki serve --personas", () => {
  it("refuses a file with a persona that has no avatar, saying which, and does not start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-serve-personas-"));
    await writeFile(join(dir, "p.yaml"), "personas:\n  ada:\n    voice: af_heart\n");
    const r = await run(["--port", "0", "--personas", join(dir, "p.yaml")], () => false);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/ada.*avatar/i);
    expect(r.out).not.toMatch(/serving/);
  });

  it("refuses a file whose avatar is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-serve-personas-"));
    await writeFile(join(dir, "p.yaml"), "personas:\n  ada:\n    avatar: nope.vrm\n");
    const r = await run(["--port", "0", "--personas", join(dir, "p.yaml")], () => false);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/ada.*nope\.vrm/s);
  });

  it("starts with a good file, names the personas, and stops cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-serve-personas-"));
    await writeFile(join(dir, "a.vrm"), "x");
    await writeFile(join(dir, "p.yaml"), "personas:\n  ada:\n    avatar: a.vrm\n  ben:\n    avatar: a.vrm\n");
    const r = await run(["--port", "0", "--personas", join(dir, "p.yaml")], (out) => /personas: ada, ben/.test(out));
    expect(r.out).toMatch(/personas: ada, ben/);
    expect(r.code).toBe(0);
  }, 40_000);
});
