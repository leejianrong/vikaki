# ADR-0016: A thin Python client for the games `Presenter`, kept in this repo

- Status: Proposed (Jian to accept; it also sets what `agent-game-framework` ADR-0010 can rely on)
- Date: 2026-10-12
- Deciders: Jian, Claude (KAN-1935)

## Context

`agent-game-framework` is a Python package. Its brief (`docs/AVATAR-PROJECT-BRIEF.md`) wants a `Presenter` it can call with `utterance`, `cancel`, `turn_started` / `turn_ended` and `game_over`, and lifecycle events back (`speech_started`, `speech_finished`, `speech_interrupted`, `error`). It offers two wirings with the same event shapes: an in-process Python class, or JSON over a WebSocket.

Vikaki is TypeScript on Node (ADR-0006) and its hub speaks that JSON over a WebSocket (ADR-0001, [protocol.md](../protocol.md)). The brief's event names already match the protocol, so a Python caller can talk to the hub today with any WebSocket library. What is missing is a small, tested wrapper so every game does not rewrite the handshake, the id bookkeeping and the error cases. This card is the decision; the code is a follow-up.

## Decision

Build a small Python package, `vikaki-client`, in this repo under `clients/python/`, and make the framework's `Presenter` a thin adapter over it.

- **Home.** This repo, next to the protocol it speaks. The JSON Schema ([protocol.schema.json](../protocol.schema.json)) is generated here, so the client and the schema change in one pull request. The framework depends on the published client, not the other way round. The `Presenter` protocol itself and its adapter stay in `agent-game-framework` (its ADR-0010).
- **Transport.** A WebSocket client library, not a hand-rolled one: `websockets` (BSD-3-Clause, pure Python, asyncio). Licence and current release to be checked in the implementation PR before it is added. The client exposes an async API and a small blocking wrapper that runs the loop on a background thread, because the framework's `Presenter` is called from ordinary synchronous code.
- **What it covers.** `connect` as `driver` (token optional) with the `hello` / `welcome` handshake; `say(text | deltas, seat_id, utterance_id, emotion, intensity, persona, kind)`; `cancel(utterance_id=None)`; `turn_started` / `turn_ended`; `game_over`; and the lifecycle events back, as callbacks or an async iterator, keyed by `utterance_id`. It generates `utterance_id`s when the caller gives none, and a `wait_finished(utterance_id)` helper for games that wait for speech.
- **Versioning.** The client sends `protocol_version: 1` and fails on `unsupported_protocol_version`. Protocol changes are additive (CLAUDE.md), so the client ignores message types and fields it does not know. Its own version is separate from `protocol_version`; a test checks that the schema file it ships is identical to the one generated in this repo.
- **Validation.** It checks outgoing messages the way the protocol doc says a non-TypeScript client should: the JSON Schema, plus the two rules the schema cannot express (exactly one of `text` or `delta`; `final` only with `delta`).
- **Tests.** Against a fake hub (a plain WebSocket server in the test), never a paid or non-deterministic service. One integration test runs against a real `vikaki serve --tts fake` in CI.

## Out of scope

- Starting or supervising the hub. The client connects to a running `vikaki serve`; whoever runs the game starts it.
- Speech, rendering, personas files and anything else the hub does.
- `human_utterance` (speech-to-text from a human seat). The protocol does not carry it yet; that is a separate decision when STT is built.
- Several seats on one scene. The poker table cards (KAN-2059 to 2061) add a seat parameter to the protocol additively; the client follows then.
- A true in-process engine. The brief's "in-process" wiring is satisfied by the framework's `Presenter` class calling this client, with the same event shapes; the avatar itself still runs in the Node hub and the browser page.

## Alternatives considered

- **Put the client in `agent-game-framework`.** Fewer packages to publish, but it puts the protocol's second implementation in a repo that does not own the schema, so drift would go unnoticed until a game broke.
- **No client; the framework talks raw WebSocket.** Cheapest today, but the id bookkeeping, cancel and wait-for-finish logic would be rewritten per game and tested nowhere.
- **Generate the client from the JSON Schema.** The schema cannot express the two cross-field rules, and generated message classes would not give the `wait_finished` and `say` helpers. The schema is used for validation, not for code generation.
- **A Python port of the hub.** Doubles the engine for no benefit (ADR-0006).

## Consequences

- One more package to build, version and publish from this repo; the implementation card is KAN-2100.
- The protocol schema becomes a contract with a second consumer, so a change to it must keep the client's drift test green.
- `agent-game-framework` ADR-0010 can say "the Presenter calls `vikaki-client`" and no longer has to describe the wire format itself.
- Open, for Jian: whether `vikaki-client` is published to PyPI or only installed from this repo's git URL at first.
