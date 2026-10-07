#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { startServer } from "@vikaki/server";

const USAGE = `usage: vikaki serve [--port 8787] [--host 127.0.0.1] [--static <dir>]`;

// Default to the engine's built page (run \`pnpm build\` first).
const defaultStatic = fileURLToPath(new URL("../../engine/dist", import.meta.url));

async function serve(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string", default: "8787" },
      host: { type: "string", default: "127.0.0.1" },
      static: { type: "string", default: defaultStatic },
    },
  });
  if (!existsSync(values.static!)) {
    console.error(`no built page at ${values.static}; run \`pnpm build\` first`);
    process.exit(1);
  }
  const server = await startServer({
    staticDir: values.static!,
    port: Number(values.port),
    host: values.host!,
  });
  console.log(`vikaki serving ${server.url}`);

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
