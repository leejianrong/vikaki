import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

/** Run `vikaki serve` with only these flags and this environment until `done` is true of its output (or it exits); stops it with SIGINT. */
async function run(args: string[], env: Record<string, string>, done: (out: string) => boolean) {
  const pageDir = await mkdtemp(join(tmpdir(), "vikaki-serve-env-"));
  await writeFile(join(pageDir, "index.html"), "hi");
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VIKAKI_")));
  const child = spawn(process.execPath, ["--import", "tsx", entry, "serve", "--static", pageDir, "--port", "0", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...clean, ...env } });
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
const framing = (o: string) => /framing:/.test(o);

describe("vikaki serve reads its settings from VIKAKI_* variables (VIK-126)", () => {
  it("VIKAKI_TTS picks the engine, VIKAKI_TOKEN requires a token, VIKAKI_FRAME_ANCESTORS lists the embedders", async () => {
    const r = await run([], { VIKAKI_TTS: "none", VIKAKI_TOKEN: "s3cret", VIKAKI_FRAME_ANCESTORS: "https://game.example" }, framing);
    expect(r.out).toContain("(token required); speech: off");
    expect(r.out).toContain("framing: https://game.example may embed the avatar page");
    expect(r.out).not.toContain("s3cret");
    const fake = await run([], { VIKAKI_TTS: "fake" }, framing);
    expect(fake.out).toMatch(/speech: (?!off)/);
  }, 60_000);

  it("VIKAKI_PERSONAS loads a personas file, and a bad one is refused like the flag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-serve-env-personas-"));
    await writeFile(join(dir, "p.yaml"), "personas:\n  ada:\n    voice: af_heart\n");
    const r = await run([], { VIKAKI_TTS: "fake", VIKAKI_PERSONAS: join(dir, "p.yaml") }, () => false);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/ada.*avatar/i);
  }, 60_000);

  it("VIKAKI_ALLOWED_HOSTS (and --allow-host) list extra Host names; wildcards are refused (VIK-127)", async () => {
    const r = await run([], { VIKAKI_TTS: "fake", VIKAKI_ALLOWED_HOSTS: "vikaki:8787" }, framing);
    expect(r.code).not.toBe(1);
    const bad = await run([], { VIKAKI_TTS: "fake", VIKAKI_ALLOWED_HOSTS: "*" }, () => false);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/VIKAKI_ALLOWED_HOSTS does not take wildcards/);
    const badFlag = await run(["--allow-host", "http://x"], { VIKAKI_TTS: "fake" }, () => false);
    expect(badFlag.err).toMatch(/--allow-host: "http:\/\/x" is not a host name/);
  }, 60_000);

  it("--phonemes and VIKAKI_PHONEMES turn on the phonemes sent with the audio, and nothing else does (VIK-50)", async () => {
    const off = await run([], { VIKAKI_TTS: "fake" }, framing);
    expect(off.out).not.toContain("phonemes:");
    const flag = await run(["--phonemes"], { VIKAKI_TTS: "fake" }, framing);
    expect(flag.out).toContain("phonemes: sent with the audio");
    const env = await run([], { VIKAKI_TTS: "fake", VIKAKI_PHONEMES: "1" }, framing);
    expect(env.out).toContain("phonemes: sent with the audio");
    const no = await run([], { VIKAKI_TTS: "none", VIKAKI_PHONEMES: "1" }, framing);
    expect(no.out).not.toContain("phonemes:"); // speech is off: nothing to send
  }, 60_000);

  it("a flag wins over its variable", async () => {
    const r = await run(["--tts", "fake", "--token", "flag", "--frame-ancestors", "none"], { VIKAKI_TTS: "none", VIKAKI_TOKEN: "env", VIKAKI_FRAME_ANCESTORS: "https://game.example" }, framing);
    expect(r.out).toMatch(/\(token required\); speech: (?!off)/);
    expect(r.out).toContain("framing: no other page may embed");
  }, 60_000);

  it("a bad value names the variable and does not start; an empty one counts as unset", async () => {
    const bad = await run([], { VIKAKI_TTS: "loud" }, () => false);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/VIKAKI_TTS must be auto, kokoro, fake or none, not "loud"/);
    const badFrame = await run([], { VIKAKI_TTS: "fake", VIKAKI_FRAME_ANCESTORS: "*" }, () => false);
    expect(badFrame.code).toBe(1);
    expect(badFrame.err).toMatch(/wildcards/);
    const empty = await run([], { VIKAKI_TTS: "fake", VIKAKI_TOKEN: "", VIKAKI_FRAME_ANCESTORS: "", VIKAKI_PERSONAS: "" }, framing);
    expect(empty.out).not.toContain("token required");
    expect(empty.out).toContain("(--frame-ancestors to change)");
  }, 60_000);
});
