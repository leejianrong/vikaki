import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const tsx = `${root}/node_modules/.bin/tsx`;

interface Run {
  child: ChildProcess;
  out: () => string;
  ready: Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; ms: number }>;
}

/** Start a command in its own process group, the way a terminal does, and collect everything it prints. */
function start(cmd: string, args: string[], cwd: string): Run {
  const child = spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let text = "";
  child.stdout!.on("data", (d) => (text += d));
  child.stderr!.on("data", (d) => (text += d));
  const ready = new Promise<void>((ok, fail) => {
    const t = setInterval(() => text.includes("press Ctrl+C to stop") && (clearInterval(t), ok()), 50);
    child.once("exit", () => (clearInterval(t), fail(new Error(`exited before it was ready:\n${text}`))));
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; ms: number }>((ok) => {
    let sent = 0;
    (child as ChildProcess & { markSent?: () => void }).markSent = () => (sent = Date.now());
    child.once("exit", (code, signal) => ok({ code, signal, ms: Date.now() - sent }));
  });
  return { child, out: () => text, ready, exited };
}

/** Send a signal to the whole process group, like Ctrl+C does. */
function signalGroup(run: Run, signal: NodeJS.Signals) {
  (run.child as ChildProcess & { markSent?: () => void }).markSent?.();
  process.kill(-run.child.pid!, signal);
}

describe("stopping the server", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("the CLI says it is stopping, exits 0, and prints no errors on %s", async (sig) => {
    const run = start(tsx, ["src/index.ts", "serve", "--tts", "none"], `${root}/packages/cli`);
    await run.ready;
    signalGroup(run, sig);
    const { code, ms } = await run.exited;
    expect(code).toBe(0);
    expect(ms).toBeLessThan(5000);
    expect(run.out()).toContain("Stopping...");
    expect(run.out()).toContain("Stopped.");
    expect(run.out()).not.toMatch(/error|Error|ELIFECYCLE|ERR_/);
  }, 60_000);

  it("`make serve` ends on Ctrl+C with no pnpm error block and no make 'Interrupt' line", async () => {
    const run = start("make", ["serve"], root);
    await run.ready; // includes the build, so this can take a while
    signalGroup(run, "SIGINT");
    const { code, signal } = await run.exited;
    const text = run.out();
    expect(text).toContain("Stopped.");
    expect(text).not.toMatch(/ERR_PNPM|Command failed|ELIFECYCLE|Interrupt|\*\*\*/);
    // make re-raises SIGINT to itself, which is its normal way to end on Ctrl+C; both are fine.
    expect(code === 0 || signal === "SIGINT").toBe(true);
  }, 180_000);
});
