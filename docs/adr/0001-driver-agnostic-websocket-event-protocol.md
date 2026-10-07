# ADR-0001: One versioned WebSocket event protocol, shaped to the games brief

- Status: Accepted
- Date: 2026-10-07
- Deciders: Jian

## Context

Vikaki must serve a human talking into a mic now, an LLM text driver in slice 2, and games and agent teams later. The consumer brief (`agent-game-framework/docs/AVATAR-PROJECT-BRIEF.md`) already proposes event shapes: `utterance`, `cancel`, `turn_started`, `turn_ended`, `game_over` in, and `speech_started`, `speech_finished`, `speech_interrupted`, `error` out. It wants the same shapes in-process and over the network, and wants a replayable log. The engine must not know anything about any game.

## Decision

Define one JSON-over-WebSocket protocol, versioned with a `protocol_version` field on every message, whose event names and core fields match the games brief. Utterances carry text or text deltas plus optional `emotion`, `intensity`, `persona` and `kind`, never game state. Events are also appended to a JSONL log that can be replayed as a driver. Messages carry an optional `session_id`, and a driver authenticates with a token, so a hosted multi-tenant hub is possible later without changing event shapes. Mic audio is not part of the protocol in M1: in human mode it stays inside the browser page. An MCP server (`vikaki mcp`) is a thin driver over the same events, so an LLM can call `say`, `set_emotion` and `cancel` as tools.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Private protocol for M1, adapt later | Guarantees a rewrite when games arrive, and the brief already did the design work |
| Send mic audio over the socket to a server-side lip-sync | Adds latency and a network hop for the use case that must be offline (R6) |
| gRPC or a binary protocol | Harder to debug and to call from Python and shell; WebSocket JSON is enough at this volume (audio frames aside) |
| Reuse a vendor's avatar API shape | Ties us to one vendor and its limits |

## Consequences

Buys a mechanical path to the games project and an easy test story (record and replay). Costs a little up-front design in slice 2 and a commitment to the brief's names. Forecloses game-specific fields in the engine. Audio frames will need a binary or base64 path, to be settled in V2 without changing event names.
