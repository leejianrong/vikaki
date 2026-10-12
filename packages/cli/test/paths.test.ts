import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromHere } from "../src/paths.ts";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

describe("fromHere", () => {
  it("resolves a relative path from where the user ran pnpm (INIT_CWD), not from the package folder pnpm runs the CLI in", () => {
    expect(fromHere("p.yaml", { INIT_CWD: "/work/repo" }, "/work/repo/packages/cli")).toBe(resolve("/work/repo", "p.yaml"));
  });

  it("falls back to the current folder when there is no INIT_CWD (the CLI run directly)", () => {
    expect(fromHere("p.yaml", {}, "/somewhere")).toBe(resolve("/somewhere", "p.yaml"));
  });

  it("leaves an absolute path alone", () => {
    expect(fromHere("/abs/p.yaml", { INIT_CWD: "/work/repo" }, "/x")).toBe("/abs/p.yaml");
  });
});

describe("`pnpm serve --personas personas.yaml`, as the docs write it", () => {
  it("finds a relative personas file in the folder pnpm was run from", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-init-cwd-"));
    await writeFile(join(dir, "a.vrm"), "x");
    await writeFile(join(dir, "p.yaml"), "personas:\n  ada:\n    avatar: a.vrm\n");
    const page = await mkdtemp(join(tmpdir(), "vikaki-init-cwd-page-"));
    await writeFile(join(page, "index.html"), "hi");
    // The CLI runs in its own package folder (as under `pnpm serve`); INIT_CWD says where the user was.
    const child = spawn(process.execPath, ["--import", "tsx", entry, "serve", "--tts", "fake", "--static", page, "--port", "0", "--personas", "p.yaml"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, INIT_CWD: dir },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const code = await new Promise<number | null>((ok) => {
      const timer = setTimeout(() => child.kill("SIGINT"), 20_000);
      const poll = setInterval(() => /personas: ada/.test(out) && child.kill("SIGINT"), 100);
      child.once("exit", (c) => (clearTimeout(timer), clearInterval(poll), ok(c)));
    });
    expect(err).not.toMatch(/cannot read the personas file/);
    expect(out).toMatch(/personas: ada/);
    expect(code).toBe(0);
  }, 40_000);
});
