# Vikaki protocol (version 1)

JSON text messages over a WebSocket at `ws://127.0.0.1:<port>/ws`. Every message has `protocol_version: 1` and a `type`. The event names follow the games brief (`agent-game-framework/docs/AVATAR-PROJECT-BRIEF.md`), so a game can map onto them directly. Decisions: ADR-0001. Machine-readable schema: [protocol.schema.json](protocol.schema.json).

## Roles

- **Driver**: the thing that decides what is said (a game, an LLM, a script). Only one at a time; a second gets `driver_busy`.
- **Controller**: a side channel for `vikaki cancel`. Never holds the driver slot, receives nothing, may send only `cancel`, and needs the driver token if there is one (ADR-0014).
- **Viewer**: an avatar page that plays what the driver sends and reports back. Any number.

A viewer may name the persona it shows in `hello` (`"persona": "ada"`): it then plays only that persona's lines, and the hub keeps time itself for a line whose persona no open viewer shows ([personas.md](personas.md)).

The first message on a connection must be `hello`; the hub answers `welcome`.

```json
{ "protocol_version": 1, "type": "hello", "role": "driver", "token": "optional", "session_id": "optional" }
{ "protocol_version": 1, "type": "welcome", "role": "driver" }
```

`role` is `driver`, `viewer` or `controller`. When the hub was started with a personas file, `welcome` also carries `personas`, the names it knows ([personas.md](personas.md)).

## Driver sends

| type | fields | notes |
| --- | --- | --- |
| `utterance` | `seat_id`, `utterance_id`, `text` **or** `delta` (+ `final`), optional `emotion`, `intensity` (0..1), `persona`, `kind` (`banter`, `clue`, `table_talk`) | `text` is a whole line. For a line still being written, send `delta` chunks in order and end with `final: true`. |
| `cancel` | optional `utterance_id` | Stop that line now. Without an id, stop everything speaking or queued. A controller sends the same message. |
| `turn_started` / `turn_ended` | `seat_id`, optional `persona` | While a turn is on, the avatar looks thoughtful (head tipped, a bubble of dots). A line that starts ends it; a driver that never sends `turn_ended` is cleared after 30 s. `vikaki say --think 2` does this before speaking. `persona` says whose turn it is: a page showing one persona ignores other personas' turns (and turns that name nobody). |
| `game_over` | `outcome` (`won`, `lost`, `drew`), optional `seat_id` | |

`emotion` is one of `neutral`, `happy`, `smug`, `worried`, `surprised`, `sad`, `angry`. Anything else, or nothing, is `neutral`; it is never an error (the hub logs a warning for an unknown name). `intensity` scales it from 0 to 1 and defaults to 1. The page shows it while the line is heard and relaxes shortly after; ADR-0015 says how it looks.

## Driver receives

| type | fields |
| --- | --- |
| `speech_started` | `utterance_id`, optional `seat_id` |
| `speech_finished` | `utterance_id`, optional `timing` |
| `speech_interrupted` | `utterance_id`, `reason` (`cancelled`, `superseded`, `human_spoke`, `driver_disconnected`) |
| `error` | `code`, `message`, optional `utterance_id` |

`timing` is what the page measured on its own clock, in ms from receiving the line: `audio_ms` until the first sound was heard, and `frame_ms` until the first rendered frame with the mouth open (absent if the line ended first). It is reported, never gated. `vikaki say` also measures send-to-heard itself and prints `time to first audio` and, when a page reported it, `time to first video frame`. `vikaki serve` prints how long the engine took to make the first audio. The local target is under 1500 ms (Q16).

When several viewers report the same event, the driver hears it once.

## Errors

`bad_message` (invalid JSON or fields; the connection stays open after `hello`), `unsupported_protocol_version`, `unauthorized` (wrong driver token), `driver_busy`, `not_allowed` (a role sent something it may not), `unknown_persona` (a line named a persona the hub's personas file lacks; the line is dropped), `tts_failed`, `internal`.

## Security

The hub listens on localhost only. It refuses browser connections from other sites (by `Origin`) and requests whose `Host` is not a local name (DNS rebinding). Programs with no `Origin` header, such as the CLI, are accepted. A driver token can be required. Messages are capped at 256 KB.

## Limits of the JSON Schema

The schema describes field types and ranges. It cannot express "exactly one of `text` or `delta`" or "`final` only with `delta`"; the hub enforces those. A client in another language should check them too.

## Speech from the hub to viewers

When the hub has a speech engine, it speaks each `utterance` and sends the result to every viewer as `audio` messages. Only the hub sends these.

```json
{ "protocol_version": 1, "type": "audio", "utterance_id": "u1", "seat_id": "seat-1",
  "seq": 0, "sample_rate": 24000, "pcm": "<base64 of 16-bit little-endian mono>", "final": false,
  "sentence_index": 0, "sentence_text": "Good morning, everyone." }
```

- Slices of one utterance arrive in `seq` order, each at most one second long. The last has `final: true` and may carry no samples.
- `sentence_index` says which spoken piece (a sentence, or a clause of a long one) a slice belongs to, counting from 0. `sentence_text` is that piece's text and appears on its first slice only. `sentence_end: true` appears on an empty slice sent straight after a piece's last audio, so a page can work out that piece's words as soon as it is complete. All three are optional, absent on the closing `final` marker, and let a page label what it is playing (the timeline and karaoke views use them). Older pages ignore them.
- Audio is base64 inside JSON. It is simple to debug and costs about a third more bytes, which does not matter on localhost (about 64 KB/s at 24 kHz).
- A viewer plays slices back to back and reports `speech_started` when the first one actually begins, `speech_finished` when the last one ends, and `speech_interrupted` if it is cut off.
- Utterances are spoken one at a time, in the order received.
- `cancel` stops synthesis, drops anything queued for that utterance, and tells viewers to stop. A driver that keeps streaming text for a cancelled utterance is ignored, not scolded.
- If a speech engine fails, the driver gets `error` with `code: "tts_failed"` and the `utterance_id`, and the utterance is cancelled.
- **With no viewer connected** the hub plays the speech itself in real time and sends the driver the same `speech_started` and `speech_finished` (or `speech_interrupted`), so a game never waits on a face that is not there.
- A viewer whose browser has not yet been allowed to make sound (no click yet) does the same: it keeps time silently and reports on schedule.

## Event log and replay

`vikaki serve --event-log run.jsonl` writes every message the hub sees, one JSON object per line: `{ "at": <ms>, "from": "driver"|"controller"|"viewer"|"hub", "to": "driver"|"viewers", "message": {...} }`. Audio keeps only `pcm_bytes`, not the samples. `vikaki replay run.jsonl [--speed N]` connects as the driver and sends the recorded driver and controller messages again, with their original gaps divided by N, then waits for the speech to finish. Through a hub with the same engine it produces the same event sequence.
