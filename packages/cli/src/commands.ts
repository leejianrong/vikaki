import { make, type Message } from "@vikaki/protocol";
import { readEventLog } from "@vikaki/server";
import { HubClient, HubError } from "./hub-client.ts";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface Target {
  url: string;
  token?: string;
}

/** Turn a connection failure into a sentence a person can act on. */
function explain(err: unknown, io: Io): number {
  if (err instanceof HubError) {
    io.err(err.code === "driver_busy" ? "another driver (an LLM over MCP, a game, or another `vikaki say`) is connected. Stop it, or use `vikaki cancel` to silence it." : err.message);
    return 1;
  }
  throw err;
}

export interface SayOptions extends Target {
  text: string;
  persona?: string;
  emotion?: string;
  seat?: string;
  /** Show the avatar thinking for this many seconds (a turn with no line yet) before the line is sent. */
  thinkSeconds?: number;
  /** Aborting sends a cancel and waits for the hub to confirm. */
  signal?: AbortSignal;
}

/** Speak one line and wait until it is over. Exit code: 0 spoken, 1 failed or interrupted, 130 cancelled by the caller. */
export async function say(o: SayOptions, io: Io): Promise<number> {
  let client: HubClient;
  try {
    client = await HubClient.connect({ url: o.url, token: o.token, role: "driver" });
  } catch (err) {
    return explain(err, io);
  }
  try {
    if (client.welcome.speech === "off") {
      io.err("this hub has speech turned off (started with --tts none), so there is nothing to say it with");
      return 1;
    }
    const id = `cli-${Date.now().toString(36)}`;
    const seat = o.seat ?? "cli";
    if (o.thinkSeconds && o.thinkSeconds > 0) {
      client.send(make("turn_started", { seat_id: seat }));
      io.out("thinking...");
      await new Promise((ok) => setTimeout(ok, o.thinkSeconds! * 1000));
      client.send(make("turn_ended", { seat_id: seat }));
    }
    client.send(
      make("utterance", {
        seat_id: seat,
        utterance_id: id,
        text: o.text,
        ...(o.persona ? { persona: o.persona } : {}),
        ...(o.emotion ? { emotion: o.emotion } : {}),
      }),
    );
    const sentAt = Date.now();
    let heardAfter: number | undefined;
    let cancelled = false;
    o.signal?.addEventListener("abort", () => {
      cancelled = true;
      client.send(make("cancel", { utterance_id: id }));
    });
    for (;;) {
      const m = await client.next(cancelled ? 3000 : 60_000);
      if (!m) {
        io.err(cancelled ? "cancelled" : "the hub went quiet before the line finished");
        return cancelled ? 130 : 1;
      }
      if ("utterance_id" in m && m.utterance_id !== id) continue;
      if (m.type === "speech_started") {
        heardAfter = Date.now() - sentAt;
        io.out("speaking...");
        io.out(`  time to first audio: ${heardAfter} ms`);
      } else if (m.type === "speech_finished") {
        // The page measured audio to frame on its own clock; add that gap to what we measured end to end.
        if (m.timing?.frame_ms !== undefined && heardAfter !== undefined) io.out(`  time to first video frame: ${heardAfter + m.timing.frame_ms - m.timing.audio_ms} ms`);
        io.out("done");
        return 0;
      } else if (m.type === "speech_interrupted") {
        io.out(`interrupted (${m.reason})`);
        return cancelled ? 130 : 1;
      } else if (m.type === "error") {
        io.err(`${m.code}: ${m.message}`);
        return 1;
      }
    }
  } finally {
    await client.close();
  }
}

/** Stop what the avatar is saying, even while another program is driving it. With an id, only that line. */
export async function cancel(o: Target & { utteranceId?: string }, io: Io): Promise<number> {
  let client: HubClient;
  try {
    client = await HubClient.connect({ url: o.url, token: o.token, role: "controller" });
  } catch (err) {
    return explain(err, io);
  }
  client.send(make("cancel", o.utteranceId ? { utterance_id: o.utteranceId } : {}));
  await client.close();
  io.out(o.utteranceId ? `cancel sent for ${o.utteranceId}` : "cancel sent for everything that is speaking");
  return 0;
}

export interface ReplayResult {
  code: number;
  /** What the driver heard back, in order. */
  heard: Message[];
}

/** Send a recorded session's driver messages again, with their original gaps divided by `speed`. */
export async function replay(o: Target & { file: string; speed?: number }, io: Io): Promise<ReplayResult> {
  const speed = o.speed ?? 1;
  const sent = (await readEventLog(o.file)).filter((e) => e.from === "driver" || e.from === "controller");
  if (sent.length === 0) {
    io.err(`${o.file} has no driver messages to replay`);
    return { code: 1, heard: [] };
  }
  let client: HubClient;
  try {
    client = await HubClient.connect({ url: o.url, token: o.token, role: "driver" });
  } catch (err) {
    return { code: explain(err, io), heard: [] };
  }
  const heard: Message[] = [];
  const open = new Set<string>();
  /** Collect what comes back for `ms`, so the gaps between sent messages keep their original length. */
  const drain = async (ms: number) => {
    const end = Date.now() + ms;
    for (;;) {
      const m = await client.next(Math.max(0, end - Date.now()));
      if (!m) return;
      heard.push(m);
      if (m.type === "speech_finished" || m.type === "speech_interrupted") open.delete(m.utterance_id);
    }
  };
  try {
    let prev = sent[0]!.at;
    for (const e of sent) {
      await drain(Math.max(0, (e.at - prev) / speed));
      prev = e.at;
      const m = e.message as Message;
      if (m.type === "utterance") open.add(m.utterance_id);
      if (m.type === "cancel" && m.utterance_id) open.delete(m.utterance_id);
      client.send(m);
    }
    const deadline = Date.now() + 60_000;
    while (open.size > 0 && Date.now() < deadline) await drain(200);
    io.out(`replayed ${sent.length} messages from ${o.file}`);
    return { code: open.size === 0 ? 0 : 1, heard };
  } finally {
    await client.close();
  }
}
