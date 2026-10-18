# ADR-0024: A human's speech is text, sent by the page to the driver of that seat

- Status: Accepted (Wavelength wants the human to say a clue aloud; VIK-69)
- Date: 2026-10-19
- Deciders: Jian, Claude (VIK-69)

## Context

ADR-0016 left `human_utterance` out: the protocol had no way to tell a game what a person said. Wavelength would like the human to say a clue aloud and have the game see it. Building speech-to-text is not part of this card. The open choices were what the message carries (text, audio, or both), who sends it, who receives it, and whether the avatar says it back.

## Decision

- **Text only.** A new additive message, `human_utterance`: `seat_id`, `text` (1 to 2000 characters) and an optional `final` (`false` for a partial transcript still being recognised; absent or `true` for the finished line). No audio: the hub has no recogniser, and a game wants words. Audio can be a later, separate message if a recogniser ever lives in the hub. `protocol_version` stays 1.
- **A viewer sends it; the driver of that seat receives it.** The viewer is the avatar page, which relays what its host gives it. The host page (the game, which owns the microphone and the recogniser) posts `{ "type": "human_utterance", "seat_id", "text", "final"? }` to the framed avatar page, under the same rules as `unlock` (ADR-0020): only from the parent window, only from the origin named in `?parent=`. The page checks the shape, then sends it to the hub as a viewer. The hub gives it to the whole table's driver, or else to the seat driver that has that seat (ADR-0017), and to no one else: not to the other viewers, and not to the other seats' drivers (a seat is a player; what one person said to one seat is not another's business). A seat nobody drives is dropped quietly.
- **A driver and a controller may not send it.** The driver sets and the viewer sets stay apart (a test keeps it so), and a driver that has its own recogniser has no need to send a person's words to itself. The driver hears it through `events()` and `on_event` in the Python client, as it hears speech events.
- **It is not spoken, and it does not interrupt.** The avatar does not say a human's line back, and the message does not cut off a line being played. A game that wants the avatar to answer sends an `utterance`; one that wants a line cut off sends `cancel` (the `human_spoke` interrupt reason stays for a page that stops its own lines when a microphone hears someone).
- **No speech-to-text here.** Wavelength (or any host) brings its own recogniser, such as the browser's.

## Consequences

- A game gets partial and final transcripts as they come and decides what to do with them; the hub keeps no history.
- A page with no `?parent=` hears nothing from a host, so a host that forgot it sends nothing, silently, as with `unlock`.
- The hub does not check that the seat exists at the table; that is the game's own bookkeeping.
- A hub-side recogniser, audio frames from a page's own microphone, or showing the transcript to the other viewers would each be a new additive message or option.
