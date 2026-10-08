import { describe, expect, it } from "vitest";
import { formatChecks, runDoctor, type DoctorEnv } from "../src/doctor.ts";
import { findVoice, modelPath } from "../src/voice.ts";

const ROOT = "/repo";
const has = (...paths: string[]) => (p: string) => paths.includes(p);
const LOCAL_ENTRY = `${ROOT}/.vikaki/voice/node_modules/kokoro-js/dist/kokoro.js`;
const BUILT = `${ROOT}/packages/engine/dist/index.html`;

function machine(over: Partial<DoctorEnv> = {}): DoctorEnv {
  return { nodeVersion: "v24.10.0", root: ROOT, env: {}, platformRelease: "6.1.0-generic", exists: has(), portFree: async () => true, ...over };
}
const byName = (checks: Awaited<ReturnType<typeof runDoctor>>, name: string) => checks.find((c) => c.name === name)!;

describe("findVoice", () => {
  it("finds the repo-local install", () => {
    expect(findVoice({}, ROOT, has(LOCAL_ENTRY))).toEqual({ entry: LOCAL_ENTRY, source: "local" });
  });

  it("prefers an explicit environment path over the local install", () => {
    expect(findVoice({ VIKAKI_KOKORO_PATH: "/x/kokoro.js" }, ROOT, has("/x/kokoro.js", LOCAL_ENTRY))).toEqual({ entry: "/x/kokoro.js", source: "environment" });
  });

  it("does not silently fall back when the environment path is wrong", () => {
    expect(findVoice({ VIKAKI_KOKORO_PATH: "/missing.js" }, ROOT, has(LOCAL_ENTRY))).toBeUndefined();
  });

  it("returns nothing when no voice is installed", () => {
    expect(findVoice({}, ROOT, has())).toBeUndefined();
  });
});

describe("runDoctor", () => {
  it("fails, with the exact command to run, when the real voice is missing", async () => {
    const c = byName(await runDoctor(machine({ exists: has(BUILT) })), "Real voice (Kokoro)");
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("not speech");
    expect(c.fix).toContain("make install-voice");
  });

  it("is happy when everything is in place", async () => {
    const checks = await runDoctor(machine({ exists: has(BUILT, LOCAL_ENTRY, modelPath(ROOT)) }));
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(formatChecks(checks)).toContain("All good.");
  });

  it("warns, rather than fails, when the voice is installed but its model is not downloaded", async () => {
    const c = byName(await runDoctor(machine({ exists: has(BUILT, LOCAL_ENTRY) })), "Voice model");
    expect(c.status).toBe("warn");
    expect(c.fix).toContain("make install-voice");
  });

  it("fails on an old Node, and on an unbuilt avatar page", async () => {
    const checks = await runDoctor(machine({ nodeVersion: "v18.19.0" }));
    expect(byName(checks, "Node.js").status).toBe("fail");
    expect(byName(checks, "Avatar page").status).toBe("fail");
    expect(byName(checks, "Avatar page").fix).toContain("make build");
  });

  it("only warns when port 8787 is busy, because the server picks another", async () => {
    const c = byName(await runDoctor(machine({ exists: has(BUILT), portFree: async () => false })), "Port 8787");
    expect(c.status).toBe("warn");
  });

  it("mentions the Windows browser when running under WSL", async () => {
    const checks = await runDoctor(machine({ platformRelease: "5.15.167.4-microsoft-standard-WSL2" }));
    expect(byName(checks, "Running under WSL").detail).toContain("Windows browser");
  });

  it("prints a fix under each problem and counts the failures", async () => {
    const out = formatChecks(await runDoctor(machine({ nodeVersion: "v18.0.0" })));
    expect(out).toContain("-> Install Node 22");
    expect(out).toMatch(/\d problems? to fix\./);
  });
});
