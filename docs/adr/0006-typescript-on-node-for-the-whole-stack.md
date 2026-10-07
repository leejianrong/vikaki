# ADR-0006: TypeScript on Node for the whole stack

- Status: Accepted
- Date: 2026-10-07
- Deciders: Jian (raised after the fact; the default was assumed as Q15 in the planning round)

## Context

The renderer, lip sync and the meeting extension must run in the browser, which means TypeScript or JavaScript regardless of the server language. The server (hub, CLI, MCP) is small. The consumer project (`agent-game-framework`) is Python. Local TTS engines worth considering (Piper, Kokoro) are Python or ONNX based.

## Decision

Use TypeScript for every package: page, server, CLI, MCP adapter and extension, in one pnpm monorepo on Node 24. The WebSocket protocol is language-agnostic JSON with a JSON Schema, so non-TypeScript clients (a Python `Presenter`) and non-TypeScript TTS sidecars stay easy.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Python server + TypeScript page | Two toolchains, and protocol types written twice. Python's one real advantage (local TTS and ML) is reachable through a sidecar process behind the `Tts` interface |
| Go server + TypeScript page | Single static binary is nice, but the server is tiny and still leaves the browser TypeScript. Same two-toolchain cost |
| Rust or other | No benefit for this workload |

## Consequences

Buys one language, shared types across page, hub, CLI and MCP, and the strongest MCP SDK support. Costs: users need Node installed until a single-binary build is added (Node single-executable or Bun, later), and local TTS needs a subprocess or onnxruntime-node rather than an in-process Python library. A Python client library for the games project is a separate, thin package, not a rewrite.
