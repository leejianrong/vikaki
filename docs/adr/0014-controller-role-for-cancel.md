# ADR-0014: A controller role, so `vikaki cancel` works while another program drives

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian, Claude (KAN-1917)

## Context

The hub allows one driver (ADR-0001). `vikaki cancel` is a separate process, so while `vikaki say`, a game or the MCP server holds the driver slot, a second driver would get `driver_busy` and could not stop anything. Yet "stop talking now" is the one thing a person at the keyboard most needs, and it must work on an LLM that is mid-sentence.

## Decision

A third `hello` role, `controller`. It needs the driver token when the hub has one, never takes the driver slot, receives nothing, and may send only `cancel`. `cancel` may now omit `utterance_id`, meaning everything that is speaking or queued; the hub turns it into one ordinary `cancel` per utterance still in flight, so viewers and the speech engine see only the messages they already understood.

## Consequences

- Additive: `protocol_version` stays 1. A viewer or older client never sees an id-less `cancel`.
- A controller can silence a driver but not make it speak, so the token requirement is about trust, not secrecy.
- The hub keeps a bounded set of in-flight utterance ids (added on `utterance`, removed on the first `speech_finished` or `speech_interrupted`, cleared when the driver leaves).
- The JSONL event log (`vikaki serve --event-log`) records controller messages with `from: "controller"`; `vikaki replay` sends them again as the driver's own.
