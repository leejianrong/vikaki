# ADR-0004: Licence the engine and protocol under Apache-2.0

- Status: Accepted
- Date: 2026-10-07
- Deciders: Jian

## Context

The plan is open core: a free self-hostable engine and protocol, with a possible paid hosted platform later. The aim is adoption among developers building agent teams and AI games. The licence is hard to change once outside contributors have committed.

## Decision

Release the engine, server, CLI and protocol specification under Apache-2.0.

## Alternatives considered

| Option | Why not |
|--------|---------|
| MIT | No explicit patent grant |
| AGPL-3.0 | Protects a future SaaS from cloning but discourages self-hosters and company adoption, which is the main goal |
| Source-available (BSL, SSPL) | Not open source, conflicts with the adoption goal |

## Consequences

Buys maximum adoption, the same posture as LiveKit, and a patent grant. Costs the ability to stop a larger company hosting it as a competing service. Differentiation for a paid tier must come from managed infrastructure and assets, not from licence restrictions. Bundled third-party assets (avatar models, voices) keep their own licences and must be recorded.
