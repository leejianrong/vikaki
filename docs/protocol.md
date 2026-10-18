# Vikaki protocol (version 1)

JSON text messages over a WebSocket at `ws://127.0.0.1:<port>/ws`. Every message has `protocol_version: 1` and a `type`. The event names follow the games brief (`agent-game-framework/docs/AVATAR-PROJECT-BRIEF.md`), so a game can map onto them directly. Decisions: ADR-0001. Machine-readable schema: [protocol.schema.json](protocol.schema.json).

## Roles

- **Driver**: the thing that decides what is said (a game, an LLM, a script). Only one at a time; a second gets `driver_busy`. At a table with several LLM seats, each seat can have its own driver (see below).
- **Controller**: a side channel for `vikaki cancel`. Never holds the driver slot, receives nothing, may send only `cancel`, and needs the driver token if there is one (ADR-0014).
- **Viewer**: an avatar page that plays what the driver sends and reports back. Any number.

A viewer may name the persona it shows in `hello` (`"persona": "ada"`): it then plays only that persona's lines, and the hub keeps time itself for a line whose persona no open viewer shows ([personas.md](personas.md)).

The first message on a connection must be `hello`; the hub answers `welcome`.

```json
{ "protocol_version": 1, "type": "hello", "role": "driver", "token": "optional", "session_id": "optional" }
{ "protocol_version": 1, "type": "welcome", "role": "driver" }
```

`role` is `driver`, `viewer` or `controller`. A driver that speaks for some seats only lists them, `"seats": [{ "seat_id": "seat-2", "persona": "ada" }]` (1 to 16, `persona` optional): see *One driver per seat*. When the hub was started with a personas file, `welcome` also carries `personas`, the names it knows ([personas.md](personas.md)).

## One driver per seat

A driver that lists `seats` in `hello` speaks for those seats only ([ADR-0017](adr/0017-one-driver-per-seat.md)). Drivers for different seats can be connected at once; a second driver for a seat that has one, or a driver of the whole table (no `seats`) alongside a seat driver, gets `driver_busy`. A seat driver:

- may send `utterance`, `turn_started` and `turn_ended` for its seats, `game_over` with its own `seat_id`, `react` and `thought` for its own seats, and `table_state` (which is about the whole table); anything else about another seat is `not_allowed`;
- gets its seat's `persona` filled in on lines and turns that name none (a persona named on the line wins), and is refused at `hello` if a seat names a persona the hub's personas file lacks (`unknown_persona`);
- hears `speech_started`, `speech_finished`, `speech_interrupted` and line errors only for its own lines, and may cancel only its own lines (`cancel` with no id stops just those);
- cannot reuse a line id that another driver has in flight (`bad_message`);
- leaves its lines stopped when it disconnects; the other seats go on.

Only a driver lists seats. The hub still speaks one line at a time, so two seats asked to speak together are spoken in turn.

## Driver sends

| type | fields | notes |
| --- | --- | --- |
| `utterance` | `seat_id`, `utterance_id`, `text` **or** `delta` (+ `final`), optional `emotion`, `intensity` (0..1), `persona`, `kind` (`banter`, `clue`, `table_talk`) | `text` is a whole line. For a line still being written, send `delta` chunks in order and end with `final: true`. |
| `cancel` | optional `utterance_id` | Stop that line now. Without an id, stop everything speaking or queued. A controller sends the same message. |
| `turn_started` / `turn_ended` | `seat_id`, optional `persona` | While a turn is on, the avatar looks thoughtful (head tipped, a bubble of dots). A line that starts ends it; a driver that never sends `turn_ended` is cleared after 30 s. `vikaki say --think 2` does this before speaking. `persona` says whose turn it is: a page showing one persona ignores other personas' turns (and turns that name nobody). |
| `game_over` | `outcome` (`won`, `lost`, `drew`), optional `seat_id` | |
| `react` | `seat_id`, and an `emotion`, a `gesture` (`nod`, `shake`, `tilt`) or both; optional `intensity`, `seconds` (0.2 to 10, default 1.5), `persona` | A silent reaction: the seat shows the feeling for `seconds` and then it eases away, and nods, shakes its head or tilts it, without speaking, so it does not wait in the speech queue. The feeling is one of the seven emotions (unknown shows `neutral`). Ignored while that seat is speaking (its line's feeling wins) or thinking (the thinking pose wins). A seat driver may react only for its own seats, and `persona` is filled in from the seat. |
| `thought` | `seat_id`, `text` (1 to 1000 characters), optional `persona` | A private thought of a seat, for the people watching ([ADR-0023](adr/0023-private-thoughts-are-not-utterances.md)): text only, never spoken and never sent to another driver, because the hub speaks every `utterance` and relays driver messages to viewers only. The table page shows it in a Thoughts panel and puts a mark over the thinker until its next turn. |
| `table_state` | `seats` (each `seat_id`, `stack`, optional `bet`, `folded`, `cards`, and for a spectator panel `hand`, `win` and `action`), optional `pot`, `street`, `board`, `dealer`, `turn` | The state of a table game, for the overlay on `?seats=` ([personas.md](personas.md)). The game owns the truth and sends the whole state each time it changes; a page draws the last one and keeps no game logic. Cards are the game's short names (`As`, `Td`) or `back` for a card face down, shown as sent: leave a hand `back` to keep it hidden. Any driver may send it, a seat driver too, and the last one wins. Viewers get it as it was sent; a viewer that has no table page ignores it. |

`emotion` is one of `neutral`, `happy`, `smug`, `worried`, `surprised`, `sad`, `angry`. Anything else, or nothing, is `neutral`; it is never an error (the hub logs a warning for an unknown name). `intensity` scales it from 0 to 1 and defaults to 1. The page shows it while the line is heard and relaxes shortly after; ADR-0015 says how it looks.

## Driver receives

| type | fields |
| --- | --- |
| `speech_started` | `utterance_id`, optional `seat_id` |
| `speech_finished` | `utterance_id`, optional `timing` |
| `speech_interrupted` | `utterance_id`, `reason` (`cancelled`, `superseded`, `human_spoke`, `driver_disconnected`) |
| `error` | `code`, `message`, optional `utterance_id` |
| `human_utterance` | `seat_id`, `text`, optional `final` | What a person said for this driver's seat, from the page ([below](#a-humans-speech)). |

`timing` is what the page measured on its own clock, in ms from receiving the line: `audio_ms` until the first sound was heard, and `frame_ms` until the first rendered frame with the mouth open (absent if the line ended first). It is reported, never gated. `vikaki say` also measures send-to-heard itself and prints `time to first audio` and, when a page reported it, `time to first video frame`. `vikaki serve` prints how long the engine took to make the first audio. The local target is under 1500 ms (Q16).

When several viewers report the same event, the driver hears it once.

## Errors

`bad_message` (invalid JSON or fields; the connection stays open after `hello`), `unsupported_protocol_version`, `unauthorized` (wrong driver token), `driver_busy`, `not_allowed` (a role sent something it may not), `unknown_persona` (a line named a persona the hub's personas file lacks; the line is dropped), `tts_failed`, `internal`.

## Security

The hub listens on localhost only. It refuses browser connections from other sites (by `Origin`) and requests whose `Host` is not a local name (DNS rebinding). Programs with no `Origin` header, such as the CLI, are accepted. A driver token can be required. Messages are capped at 256 KB.

## Limits of the JSON Schema

The schema describes field types and ranges. It cannot express "exactly one of `text` or `delta`" or "`final` only with `delta`"; the hub enforces those. A client in another language should check them too. The Python client in `clients/python` does ([ADR-0016](adr/0016-python-client-for-the-games-presenter.md)).

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
- **A `cancel` is always answered.** For a line a page was playing, the page sends `speech_interrupted`. For a line no page has heard anything of yet (still queued behind another, or still being synthesised: a real voice can take seconds for its first sentence) the hub answers at once with `speech_interrupted` and `reason: "cancelled"`, with no `speech_started` before it, and throws away whatever the voice makes for the line when it finishes. A line that failed gets its `error` and no interruption; an id the hub does not know (never sent, or already finished) gets nothing. Each line gets one answer, and it goes to the driver that sent the line, including a seat driver (ADR-0017) that sent the `cancel` itself.
- If a speech engine fails, the driver gets `error` with `code: "tts_failed"` and the `utterance_id`, and the utterance is cancelled.
- **With no viewer connected** the hub plays the speech itself in real time and sends the driver the same `speech_started` and `speech_finished` (or `speech_interrupted`), so a game never waits on a face that is not there.
- A viewer whose browser has not yet been allowed to make sound (no click yet) does the same: it keeps time silently and reports on schedule.

## A human's speech

`human_utterance` carries what a person said, as text, for a seat ([ADR-0024](adr/0024-a-humans-speech-is-text-from-the-page-to-the-seats-driver.md)). There is no speech-to-text in the hub: whoever has the microphone and a recogniser (a game's page) turns the speech into text and hands it to the avatar page, which sends it to the hub as a viewer. A driver may not send it.

| type | fields | notes |
| --- | --- | --- |
| `human_utterance` | `seat_id`, `text` (1 to 2000 characters), optional `final` | `final: false` is a partial transcript still being recognised; leave `final` out (or `true`) for the finished line. Sent by a viewer; the hub gives it to the driver of that seat (the whole table's driver gets every seat's) and to nobody else. A seat nobody drives is dropped without an error. It is not spoken and does not interrupt a line being played. |

The embedding page sends it with `postMessage` ([embed.md](embed.md#a-humans-speech)). The Python client hands it to the driver through `events()` and `on_event`.

## Messages to the page that frames the avatar page

Not hub messages: they go over `window.postMessage` from an embedded avatar page (`?embed=1`) to the page that frames it, and are not part of `protocol.schema.json`. They are described for hosts in [embed.md](embed.md); [ADR-0020](adr/0020-audio-unlock-handshake-for-embedded-pages.md) has the rules.

| Message | Fields | When |
| --- | --- | --- |
| `speech_started` | `utterance_id`, `seat_id` | The first sound of a line is heard (or would be: see below). |
| `speech_finished` | `utterance_id`, `seat_id` | The last sound of a line ended. |
| `speech_interrupted` | `utterance_id`, `seat_id`, `reason` | A line being played was cut off (`cancelled`, `human_spoke`, ...). |
| `audio_locked`, `audio_unlocked` | none | The browser blocks or allows sound. |

- **Only to the host the page was told about.** The page posts to the origin in `?parent=` and no other, never `*`, and only if the browser's own idea of its ancestor (where it has one) agrees. With no `?parent=`, or one that is not a bare origin, it posts nothing. The hub refuses to serve a page whose `?parent=` is not an allowed frame ancestor (`--frame-ancestors`).
- **Same events the page reports to the hub**, at the same moments (they are the same calls), with the seat that spoke the line. `seat_id` is the seat the line was sent for; it is left out only for a line that named none.
- **Lines the page never played are not reported here.** A line cancelled while still queued or being synthesised (VIK-71) is answered to the *driver* by the hub, and the page, which never heard of it, says nothing. A host that must know every outcome listens as a driver, or through its game server (`vikaki-client`), which gets all of them.
- **They keep coming while sound is locked.** A page that cannot make sound keeps time silently and reports on schedule, so the host's UI follows the lines whether or not the player has clicked.
- **Read-only.** The host cannot speak, cancel or skip through the page; only `unlock` and `audio_status` are accepted from it. Speech belongs to the driver.

## Event log and replay

`vikaki serve --event-log run.jsonl` writes every message the hub sees, one JSON object per line: `{ "at": <ms>, "from": "driver"|"controller"|"viewer"|"hub", "to": "driver"|"viewers", "message": {...} }`. Audio keeps only `pcm_bytes`, not the samples. `vikaki replay run.jsonl [--speed N]` connects as the driver and sends the recorded driver and controller messages again, with their original gaps divided by N, then waits for the speech to finish. Through a hub with the same engine it produces the same event sequence.
