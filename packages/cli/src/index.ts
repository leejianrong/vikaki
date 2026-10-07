#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findFreePort, startServer } from "@vikaki/server";

const USAGE = `usage: vikaki serve [--port N] [--host 127.0.0.1] [--static <dir>] [--demo] [--open]

  --port N   exact port, fails if busy. Without it, starts at 8787 and takes the next free port.
  --demo     print and open the demo page (avatar plus controls and meters)
  --open     open the page in your browser (works from WSL, macOS and Linux)`;

// Default to the engine's built page (run \`pnpm build\` first).
const defaultStatic = fileURLToPath(new URL("../../engine/dist", import.meta.url));

/** Try the usual openers in order; WSL needs to reach the Windows browser. */
function openBrowser(url: string): void {
  const candidates: [string, string[]][] = [
    ["wslview", [url]],
    ["explorer.exe", [url]],
    ["xdg-open", [url]],
    ["open", [url]],
  ];
  const tryNext = (i: number) => {
    const c = candidates[i];
    if (!c) {
      console.log("could not open a browser automatically; open the URL above yourself");
      return;
    }
    const child = spawn(c[0], c[1], { stdio: "ignore", detached: true });
    child.once("error", () => tryNext(i + 1));
    child.unref();
  };
  tryNext(0);
}

async function serve(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      static: { type: "string", default: defaultStatic },
      demo: { type: "boolean", default: false },
      open: { type: "boolean", default: false },
    },
  });
  if (!existsSync(values.static!)) {
    console.error(`no built page at ${values.static}; run \`pnpm build\` first`);
    process.exit(1);
  }
  const host = values.host!;
  const port = values.port !== undefined ? Number(values.port) : await findFreePort(8787, host);
  const server = await startServer({ staticDir: values.static!, port, host });
  const url = values.demo ? `${server.url}?demo=1` : server.url;
  console.log(`vikaki serving ${url}`);
  if (values.port === undefined && port !== 8787) console.log(`(8787 was busy, using ${port})`);
  console.log("press Ctrl+C to stop");
  if (values.open) openBrowser(url);

  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "serve") {
  await serve(rest);
} else {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
