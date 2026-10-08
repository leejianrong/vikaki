# Vikaki protocol (version 1)

JSON text messages over a WebSocket at `ws://127.0.0.1:<port>/ws`. Every message has `protocol_version: 1` and a `type`. The event names follow the games brief (`agent-game-framework/docs/AVATAR-PROJECT-BRIEF.md`), so a game can map onto them directly. Decisions: ADR-0001. Machine-readable schema: [protocol.schema.json](protocol.schema.json).

## Roles

- **Driver**: the thing that decides what is said (a game, an LLM, a script). Only one at a time; a second gets `driver_busy`.
- **Viewer**: an avatar page that plays what the driver sends and reports back. Any number.

The first message on a connection must be `hello`; the hub answers `welcome`.

```json
{ "protocol_version": 1, "type": "hello", "role": "driver", "token": "optional", "session_id": "optional" }
{ "protocol_version": 1, "type": "welcome", "role": "driver" }
```

## Driver sends

| type | fields | notes |
| --- | --- | --- |
| `utterance` | `seat_id`, `utterance_id`, `text` **or** `delta` (+ `final`), optional `emotion`, `intensity` (0..1), `persona`, `kind` (`banter`, `clue`, `table_talk`) | `text` is a whole line. For a line still being written, send `delta` chunks in order and end with `final: true`. |
| `cancel` | `utterance_id` | Stop that line now. |
| `turn_started` / `turn_ended` | `seat_id` | Lets the avatar switch to a thinking pose. |
| `game_over` | `outcome` (`won`, `lost`, `drew`), optional `seat_id` | |

`emotion` is one of `neutral`, `happy`, `smug`, `worried`, `surprised`, `sad`, `angry`. Anything else, or nothing, is `neutral`; it is never an error.

## Driver receives

| type | fields |
| --- | --- |
| `speech_started` | `utterance_id`, optional `seat_id` |
| `speech_finished` | `utterance_id` |
| `speech_interrupted` | `utterance_id`, `reason` (`cancelled`, `superseded`, `human_spoke`, `driver_disconnected`) |
| `error` | `code`, `message`, optional `utterance_id` |

When several viewers report the same event, the driver hears it once.

## Errors

`bad_message` (invalid JSON or fields; the connection stays open after `hello`), `unsupported_protocol_version`, `unauthorized` (wrong driver token), `driver_busy`, `not_allowed` (a role sent something it may not), `unknown_persona`, `tts_failed`, `internal`.

## Security

The hub listens on localhost only. It refuses browser connections from other sites (by `Origin`) and requests whose `Host` is not a local name (DNS rebinding). Programs with no `Origin` header, such as the CLI, are accepted. A driver token can be required. Messages are capped at 256 KB.

## Limits of the JSON Schema

The schema describes field types and ranges. It cannot express "exactly one of `text` or `delta`" or "`final` only with `delta`"; the hub enforces those. A client in another language should check them too.
