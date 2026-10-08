import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EMOTIONS } from "@vikaki/protocol";
import { z } from "zod";
import type { Target } from "./commands.ts";
import { DriverSession } from "./driver-session.ts";
import { HubError } from "./hub-client.ts";

const text = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

/** Something a person can act on, not a stack trace. */
function explain(err: unknown): ReturnType<typeof text> {
  if (err instanceof HubError) {
    return text(
      err.code === "driver_busy"
        ? "Another driver (a game, `vikaki say`, or another MCP client) holds the avatar. Ask the user to stop it, then try again."
        : err.message,
      true,
    );
  }
  return text(err instanceof Error ? err.message : String(err), true);
}

/** The four tools, each a thin call on one shared driver session. */
export function createMcpServer(session: DriverSession): McpServer {
  const server = new McpServer({ name: "vikaki", version: "0.0.0" });
  const guard = <A>(fn: (args: A) => Promise<ReturnType<typeof text>> | ReturnType<typeof text>) => async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return explain(err);
    }
  };

  server.registerTool(
    "say",
    {
      description:
        "Make the avatar speak a line aloud, with lip sync. By default waits until the line has been spoken (or interrupted) and returns the outcome and timings. Lines are spoken one at a time, in order. Uses the emotion and persona set earlier unless given here.",
      inputSchema: {
        text: z.string().min(1).max(5000).describe("What to say, as plain spoken text. Whole sentences work best."),
        emotion: z.string().max(32).optional().describe(`One of ${EMOTIONS.join(", ")}. Overrides set_emotion for this line.`),
        intensity: z.number().min(0).max(1).optional().describe("How strongly to show the emotion, 0 to 1."),
        persona: z.string().min(1).max(64).optional().describe("Voice or character name. Overrides set_persona for this line."),
        wait: z.boolean().optional().describe("Default true. false returns at once with the utterance_id so you can cancel it later."),
      },
    },
    guard((a) => session.say(a).then((r) => text(r, r.outcome === "failed"))),
  );

  server.registerTool(
    "set_emotion",
    {
      description: `Set the avatar's default emotion for the lines that follow. One of ${EMOTIONS.join(", ")}; anything else becomes neutral.`,
      inputSchema: { emotion: z.string().max(32) },
    },
    guard((a: { emotion: string }) => text({ emotion: session.setEmotion(a.emotion) })),
  );

  server.registerTool(
    "set_persona",
    {
      description: "Set the default persona (voice, look and character) for the lines that follow. A name the hub does not know is refused with the list of known ones, and the previous persona stays. On success the persona's style note is returned: write in that manner.",
      inputSchema: { persona: z.string().min(1).max(64) },
    },
    guard(async (a: { persona: string }) => text(await session.setPersona(a.persona))),
  );

  server.registerTool(
    "cancel",
    {
      description: "Stop speaking now. With an utterance_id, stops that line; without one, stops everything speaking or queued. The avatar returns to idle.",
      inputSchema: { utterance_id: z.string().max(128).optional() },
    },
    guard(async (a: { utterance_id?: string }) => {
      await session.cancel(a.utterance_id);
      return text({ cancelled: a.utterance_id ?? "everything" });
    }),
  );

  return server;
}

/** Serve MCP over stdio until the client goes away; the driver slot is released on the way out. */
export async function runMcp(target: Target): Promise<void> {
  const session = new DriverSession(target);
  const server = createMcpServer(session);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((ok) => (transport.onclose = ok));
  await server.connect(transport);
  process.stdin.on("end", () => void transport.close()); // the client exited: let go of the driver slot
  await closed;
  await session.close();
}
