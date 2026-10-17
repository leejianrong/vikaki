import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

/** Run `vikaki serve ...` until `done` is true of what it has printed (or it exits); stops it with SIGINT. */
async function run(args: string[], done: (out: string) => boolean) {
  const pageDir = await mkdtemp(join(tmpdir(), "vikaki-serve-page-"));
  await writeFile(join(pageDir, "index.html"), "hi");
  const child = spawn(process.execPath, ["--import", "tsx", entry, "serve", "--tts", "fake", "--static", pageDir, "--port", "0", ...args], { stdio: ["ignore", "pipe", "pipe"] });
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

describe("vikaki serve --frame-ancestors", () => {
  it("says who may embed the page: localhost by default, and the list when one is given", async () => {
    const a = await run([], (o) => /framing:/.test(o));
    expect(a.out).toContain("framing: http://127.0.0.1:*, http://localhost:* may embed the avatar page (--frame-ancestors to change)");
    const b = await run(["--frame-ancestors", "http://127.0.0.1:8765,https://game.example"], (o) => /framing:/.test(o));
    expect(b.out).toContain("framing: http://127.0.0.1:8765, https://game.example may embed the avatar page");
    expect(b.out).not.toContain("--frame-ancestors to change");
    const c = await run(["--frame-ancestors", "none"], (o) => /framing:/.test(o));
    expect(c.out).toContain("framing: no other page may embed the avatar page");
  }, 60_000);

  it("refuses a wildcard or a malformed origin, saying what is wrong, and does not start", async () => {
    for (const [bad, message] of [["*", /wildcards/], ["https://game.example/play", /is not an origin/], ["game.example", /is not an origin/]] as const) {
      const r = await run(["--frame-ancestors", bad], () => false);
      expect(r.code, bad).toBe(1);
      expect(r.err, bad).toMatch(message);
      expect(r.out, bad).not.toMatch(/serving/);
    }
  }, 60_000);
});
