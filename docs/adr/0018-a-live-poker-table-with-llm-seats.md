# ADR-0018: A live poker table: a rules engine, LLM seats over OpenRouter, silent reactions and table state

- Status: Proposed (Jian asked for the live table on 2026-10-14; cards VIK-56 to 60)
- Date: 2026-10-14
- Deciders: Jian, Claude

## Context

The table shows three avatars, one driver per seat (ADR-0017), and `make table-hand` plays a scripted hand. Nothing plays real poker and no model decides what to say. The goal is a table where LLMs play a real hand and talk and react as it goes.

Three gaps stand between the scripted hand and that goal:

- **No game and no LLMs.** `packages/cli/src/table-demo.ts` is a fixed list of beats.
- **Reactions need speech.** An emotion shows only while a line is spoken. A seat that is not talking breathes, blinks and sways, and does not look at whoever is.
- **The page shows faces only.** There are no cards, chips, pot or turn marker, and no table state in the protocol.

## Decision

Build it as an example on top of the engine, and add two small, additive pieces to the protocol. `protocol_version` stays 1.

1. **The rules live in `examples/poker/`, not in the engine.** A pure Texas Hold'em engine (Python): deal, betting rounds, showdown, side pots, the list of legal actions, a seeded shuffle. The engine and the page know nothing about poker; the example is one game built on `vikaki-client` (ADR-0016). It owns the truth: an LLM chooses an action and says something, and never decides the state of the game (VIK-56).
2. **One LLM per seat, through an OpenAI-compatible API (OpenRouter).** Each seat is its own driver (ADR-0017). A seat is shown only its own hole cards and the board, and returns `{action, say, emotion}`. An illegal action folds the hand and is logged, so a bad model output never stalls the table. The model is set per seat in the personas file, with an optional cheaper model for reactions. The key comes from `OPENROUTER_API_KEY` (a git-ignored `.env` works) and is never logged. Tokens per turn are capped and spend per run is logged (VIK-57).
3. **A silent `react` event.** An emotion plus a short pose for a seat, with no speech. Seats look at the current speaker. A listener-reaction hook lets the runner ask a cheap model how a seat feels about what it just heard, and send the answer as `react` (VIK-58).
4. **A `table_state` viewer event and an overlay.** The game sends pot, stacks, community cards, dealer button and turn marker; the page draws them and a transcript strip. The page holds no game logic (VIK-59).
5. **Tests never call a paid service.** The LLM sits behind a small interface with a scripted fake, as `FakeTts` does for speech. A real OpenRouter run is a manual demo, not a test.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Poker rules in the engine or the page | Ties a general avatar engine to one game, and the page would have to be trusted with hidden cards |
| Put the game in `agent-game-framework` | It remains the right home for a real Presenter integration. This repo needs a self-contained, demoable table to judge the avatar work, and the Python client already connects the two |
| Let the LLM track the game state | Models miscount chips and invent cards. The engine tells each seat what is true |
| Reactions as speech (a short line such as "ooh") | One voice at a time, so a reaction waits in the queue behind whoever is talking. A silent event costs no audio and does not wait |
| A vendor SDK per provider | OpenRouter's OpenAI-compatible endpoint covers many models with one thin call and no new heavy dependency |
| More than one speech engine, so seats can talk over each other | Heavy, and ADR-0017 says it is not planned. Silent reactions give most of the liveliness |

## Consequences

- **Latency.** An LLM turn, then speech (about 1.6 s to the first sentence with Kokoro on CPU), can leave dead air. The thinking pose covers some of it and `say_stream` speaks the first sentence before the rest is known. A cheaper reaction model keeps the table lively without doubling the wait.
- **Cost.** A hand with three seats and reactions is many calls. The token cap and the spend log are part of VIK-57, not afterthoughts.
- **Two additive protocol messages** (`react`, `table_state`). After they land, run `pnpm --filter @vikaki/protocol schema` (it also updates the schema copy in `clients/python`). Old clients ignore events they do not know.
- **The 3D look is a separate question.** Seated avatars with hands, cards and chips are a spike (VIK-60). If it changes the `AvatarRenderer` contract, it gets its own ADR.
- **Open:** whether `table_state` should carry hidden hole cards for a spectator who may see them all (a "reveal" setting), and whether `react` should be limited to the seven emotions or take named poses.
