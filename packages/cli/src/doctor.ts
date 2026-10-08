import { existsSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { findVoice, INSTALL_COMMAND, modelPath } from "./voice.ts";

export interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** What to do, when it is not ok. */
  fix?: string;
}

export interface DoctorEnv {
  nodeVersion: string;
  root: string;
  env: NodeJS.ProcessEnv;
  platformRelease: string;
  exists(path: string): boolean;
  /** Whether a TCP port can be bound on localhost. */
  portFree(port: number): Promise<boolean>;
}

/** Everything the doctor looks at, so it can be tested with a pretend machine. */
export async function runDoctor(d: DoctorEnv): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(d.nodeVersion.replace(/^v/, "").split(".")[0]);
  checks.push(
    major >= 22
      ? { name: "Node.js", status: "ok", detail: `${d.nodeVersion}` }
      : { name: "Node.js", status: "fail", detail: `${d.nodeVersion} is too old`, fix: "Install Node 22 or newer (Node 24 is what the project uses)." },
  );

  const built = d.exists(join(d.root, "packages", "engine", "dist", "index.html"));
  checks.push(
    built
      ? { name: "Avatar page", status: "ok", detail: "built" }
      : { name: "Avatar page", status: "fail", detail: "not built yet", fix: "Run `make build` (or just `make demo-speech`, which builds first)." },
  );

  const free = await d.portFree(8787);
  checks.push(
    free
      ? { name: "Port 8787", status: "ok", detail: "free" }
      : { name: "Port 8787", status: "warn", detail: "in use; vikaki will pick the next free port on its own", fix: "Nothing needed. Pass --port to choose one." },
  );

  const voice = findVoice(d.env, d.root, d.exists);
  if (!voice) {
    checks.push({
      name: "Real voice (Kokoro)",
      status: "fail",
      detail: "not installed, so the demos fall back to a steady 'aah' test voice that is not speech",
      fix: `Run \`${INSTALL_COMMAND}\` (about 410 MB, then a 90 MB model download).`,
    });
  } else {
    checks.push({ name: "Real voice (Kokoro)", status: "ok", detail: `installed (${voice.source})` });
    const model = d.exists(modelPath(d.root));
    checks.push(
      model || voice.source !== "local"
        ? { name: "Voice model", status: "ok", detail: model ? "downloaded" : "location not checked for this install" }
        : { name: "Voice model", status: "warn", detail: "not downloaded yet; the first run will download about 90 MB", fix: `Run \`${INSTALL_COMMAND}\` to fetch it now.` },
    );
  }

  const wsl = /microsoft|wsl/i.test(d.platformRelease);
  checks.push(
    wsl
      ? { name: "Running under WSL", status: "ok", detail: "open the printed http://127.0.0.1 address in your Windows browser; microphone use needs that localhost address" }
      : { name: "Platform", status: "ok", detail: "native" },
  );
  return checks;
}

export const realDoctorEnv = async (): Promise<DoctorEnv> => {
  const { findFreePort } = await import("@vikaki/server");
  const { repoRoot } = await import("./voice.ts");
  return {
    nodeVersion: process.version,
    root: repoRoot,
    env: process.env,
    platformRelease: release(),
    exists: existsSync,
    portFree: async (port) => (await findFreePort(port, "127.0.0.1", 1).catch(() => -1)) === port,
  };
};

export function formatChecks(checks: Check[]): string {
  const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" } as const;
  const lines = checks.flatMap((c) => [`  ${mark[c.status]}  ${c.name}: ${c.detail}`, ...(c.fix && c.status !== "ok" ? [`        -> ${c.fix}`] : [])]);
  const bad = checks.filter((c) => c.status === "fail").length;
  return [...lines, "", bad ? `${bad} problem${bad > 1 ? "s" : ""} to fix.` : "All good."].join("\n");
}
