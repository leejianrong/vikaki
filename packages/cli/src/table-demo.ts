import { make } from "@vikaki/protocol";
import type { Io, Target } from "./commands.ts";
import { HubClient, HubError } from "./hub-client.ts";

/** The three seats of the demo table, each bound to the persona it uses (see `personas.table.example.yaml`). */
export const TABLE_SEATS = [
  { seat_id: "seat-1", persona: "ada" },
  { seat_id: "seat-2", persona: "ben" },
  { seat_id: "seat-3", persona: "cy" },
] as const;

/** What the table shows after a beat: the game's truth, which the demo script writes out and the page only draws (VIK-59). */
interface Shown {
  pot: number;
  street: string;
  board: string[];
  stacks: [number, number, number];
  bets: [number, number, number];
  folded?: 0 | 1 | 2;
  /** Show every hand face up, as at a showdown. */
  reveal?: boolean;
}

interface Beat {
  /** Index into TABLE_SEATS. */
  seat: 0 | 1 | 2;
  /** Seconds the seat looks thoughtful before it speaks. */
  think?: number;
  say: string;
  emotion: string;
  /** The table once this line is said. */
  shown: Shown;
}

/** A short, friendly hand of poker: a raise, a call, a fold, a bluff that is not one. Nobody is rude. */
const HAND: Beat[] = [
  { seat: 0, think: 1.2, say: "Before the flop, I raise two chips.", emotion: "smug", shown: { pot: 2, street: "preflop", board: [], stacks: [98, 100, 100], bets: [2, 0, 0] } },
  { seat: 1, think: 1.6, say: "Hmm, two chips. I will call.", emotion: "worried", shown: { pot: 4, street: "preflop", board: [], stacks: [98, 98, 100], bets: [2, 2, 0] } },
  { seat: 2, think: 1.0, say: "That is too rich for me. I fold!", emotion: "sad", shown: { pot: 4, street: "preflop", board: [], stacks: [98, 98, 100], bets: [2, 2, 0], folded: 2 } },
  { seat: 0, think: 0.8, say: "The flop is an ace and two sevens. Lovely.", emotion: "happy", shown: { pot: 4, street: "flop", board: ["As", "7d", "7c"], stacks: [98, 98, 100], bets: [0, 0, 0], folded: 2 } },
  { seat: 1, think: 2.0, say: "Two sevens... is she bluffing? I check.", emotion: "worried", shown: { pot: 4, street: "flop", board: ["As", "7d", "7c"], stacks: [98, 98, 100], bets: [0, 0, 0], folded: 2 } },
  { seat: 0, think: 0.6, say: "I bet four chips.", emotion: "smug", shown: { pot: 8, street: "flop", board: ["As", "7d", "7c"], stacks: [94, 98, 100], bets: [4, 0, 0], folded: 2 } },
  { seat: 1, think: 1.8, say: "Okay, okay. I call. Let us see them.", emotion: "surprised", shown: { pot: 12, street: "flop", board: ["As", "7d", "7c"], stacks: [94, 94, 100], bets: [4, 4, 0], folded: 2 } },
  { seat: 0, say: "Three sevens! Thank you for the chips.", emotion: "happy", shown: { pot: 12, street: "showdown", board: ["As", "7d", "7c"], stacks: [94, 94, 100], bets: [0, 0, 0], folded: 2, reveal: true } },
  { seat: 1, say: "Oh no. Well played, ada.", emotion: "sad", shown: { pot: 0, street: "showdown", board: ["As", "7d", "7c"], stacks: [106, 94, 100], bets: [0, 0, 0], folded: 2, reveal: true } },
];

export interface HandOptions extends Target {
  /** Scales the thinking pauses: 1 is as written, 0 skips them (for tests). */
  pace?: number;
}

/** Hands at showdown: the demo's three seats reveal them, and the others stay face down. */
const HOLE: [string[], string[], string[]] = [["7h", "Kd"], ["Qs", "Jc"], ["2c", "9h"]];

/** The `table_state` message for a beat, with `turn` set to whoever is speaking (or nobody). */
export function tableState(shown: Shown, turn?: 0 | 1 | 2) {
  return make("table_state", {
    pot: shown.pot,
    street: shown.street,
    board: shown.board,
    dealer: TABLE_SEATS[0].seat_id,
    ...(turn !== undefined ? { turn: TABLE_SEATS[turn].seat_id } : {}),
    seats: TABLE_SEATS.map((seat, i) => ({
      seat_id: seat.seat_id,
      stack: shown.stacks[i]!,
      ...(shown.bets[i] ? { bet: shown.bets[i] } : {}),
      ...(shown.folded === i ? { folded: true } : {}),
      cards: shown.reveal && shown.folded !== i ? HOLE[i]! : ["back", "back"],
    })),
  });
}

/** The table as the hand begins: everyone has 100 chips. */
const START: Shown = { pot: 0, street: "preflop", board: [], stacks: [100, 100, 100], bets: [0, 0, 0] };

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/**
 * Play the scripted hand with one driver per seat, as three LLMs at a table would be wired (ADR-0017): each seat looks thoughtful, then
 * speaks, in turn, and each driver hears back only about its own lines. Open `?seats=3` on the hub to watch. Returns an exit code.
 */
export async function playHand(o: HandOptions, io: Io): Promise<number> {
  const clients: HubClient[] = [];
  try {
    for (const seat of TABLE_SEATS) clients.push(await HubClient.connect({ url: o.url, token: o.token, role: "driver", client: "vikaki-table-demo", seats: [seat] }));
  } catch (err) {
    await Promise.all(clients.map((c) => c.close()));
    if (err instanceof HubError && err.code === "unknown_persona") {
      io.err(`this hub does not have the personas the demo table uses (ada, ben, cy): ${err.message}. Start it with: pnpm serve --personas personas.table.example.yaml`);
      return 1;
    }
    if (err instanceof HubError) {
      io.err(err.code === "driver_busy" ? `the table is already driven by something else (${err.message}). Stop it first.` : err.message);
      return 1;
    }
    throw err;
  }
  try {
    if (clients[0]!.welcome.speech === "off") {
      io.err("this hub has speech turned off (started with --tts none), so there is nothing to say it with");
      return 1;
    }
    io.out("a hand of poker at a table of three. Watch it at /avatar?seats=3");
    let n = 0;
    for (const beat of HAND) {
      const seat = TABLE_SEATS[beat.seat];
      const client = clients[beat.seat]!;
      if (beat.think && (o.pace ?? 1) > 0) {
        client.send(make("turn_started", { seat_id: seat.seat_id }));
        await sleep(beat.think * 1000 * (o.pace ?? 1));
        client.send(make("turn_ended", { seat_id: seat.seat_id }));
      } else if (beat.think) {
        client.send(make("turn_started", { seat_id: seat.seat_id }));
        client.send(make("turn_ended", { seat_id: seat.seat_id }));
      }
      const id = `hand-${++n}`;
      const before = n > 1 ? HAND[n - 2]!.shown : START;
      client.send(tableState(before, beat.seat)); // the turn marker moves to whoever is about to speak
      io.out(`${seat.seat_id} (${seat.persona}): ${beat.say}`);
      client.send(make("utterance", { seat_id: seat.seat_id, utterance_id: id, text: beat.say, emotion: beat.emotion })); // the hub fills in the persona
      for (;;) {
        const m = await client.next(60_000);
        if (!m) {
          io.err(`the hub went quiet before ${seat.seat_id} finished its line`);
          return 1;
        }
        if (!("utterance_id" in m) || m.utterance_id !== id) continue;
        if (m.type === "speech_finished") break;
        if (m.type === "speech_interrupted") {
          io.err(`${seat.seat_id}'s line was interrupted (${m.reason})`);
          return 1;
        }
        if (m.type === "error") {
          io.err(`${m.code}: ${m.message}`);
          return 1;
        }
      }
      client.send(tableState(beat.shown)); // once the line is said: the chips and cards it changed
    }
    clients[0]!.send(make("game_over", { outcome: "won", seat_id: TABLE_SEATS[0].seat_id }));
    clients[1]!.send(make("game_over", { outcome: "lost", seat_id: TABLE_SEATS[1].seat_id }));
    clients[2]!.send(make("game_over", { outcome: "lost", seat_id: TABLE_SEATS[2].seat_id }));
    await sleep(100); // let the three game_overs leave before the connections close
    io.out("hand over: ada wins");
    return 0;
  } finally {
    await Promise.all(clients.map((c) => c.close()));
  }
}
