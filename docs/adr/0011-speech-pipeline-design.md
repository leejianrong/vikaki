# ADR-0011: Speech pipeline: one speaker at a time, lookahead playback, simulated playback when unwatched

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian, Claude (slice V2.4 and V2.5)

## Context

Text from a driver has to become speech on an avatar page, with `speech_started`, `speech_finished` and `speech_interrupted` reported back, and cancel has to work mid-sentence. The games brief wants audio to start as soon as the first sentence is ready, and wants a failed or absent renderer never to stall a match.

## Decision

- **Synthesis on the hub, playback on the page.** The hub chunks text into sentences (`SentenceChunker`), synthesizes each in order, and sends PCM slices (base64 in JSON, at most one second each) to viewers. Pages play them and report the lifecycle, because only the page knows when sound is actually heard.
- **One utterance at a time**, in arrival order. A later utterance's text is synthesized while an earlier one plays, so there is no gap.
- **Lookahead playback.** A page schedules about 0.4 s of audio ahead, not the whole utterance, so a cancel leaves no silent hole before the next line (`Playback`, a pure class tested with a fake clock).
- **Simulated playback when nobody is watching** (no viewer connected, or a page whose browser has not allowed sound yet): the same lifecycle events are produced on a real-time schedule, so the driver is never left waiting.
- **A silent keep-alive source feeds the lip-sync driver.** Without one the browser stops processing it when its real input ends and the mouth freezes at the last loud reading (found by test; the 410 MB question of "why" is in the commit and the test).
- Several viewers' identical reports reach the driver once.

## Alternatives considered

| Option | Why not |
| --- | --- |
| The page synthesizes speech | Puts a large model in every browser tab, and a driver with no page could not speak |
| Hub reports `speech_started` when audio is sent | It would be wrong by the playback delay, and meaningless with no page |
| Schedule a whole utterance at once | Cancel then leaves a gap equal to the cancelled remainder |
| Binary WebSocket frames for audio | Faster, but harder to read in logs and tests; revisit only if bandwidth matters |
| Let utterances overlap | Needs a mixer and a policy per seat. Not needed yet; the protocol does not forbid it later |

## Consequences

Buys prompt cancel, accurate lifecycle events, and a driver that works with or without a screen. Costs about a third more bytes for audio, and one speaker at a time (two seats cannot talk over each other yet, which games like poker may later want). Playback accuracy depends on the page's audio clock; the lifecycle events are reported on a 30 ms tick.
