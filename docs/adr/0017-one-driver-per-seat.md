# ADR-0017: One driver per seat, with the seat's persona set in `hello`

- Status: Accepted (Jian asked for the poker table cards, VIK-46 to 48; this is the hub half)
- Date: 2026-10-12
- Deciders: Jian, Claude (VIK-46)

## Context

ADR-0001 allows one driver. At a poker table each seat is an LLM, and the natural way to wire that is one driver connection per seat (one `vikaki mcp` or one Python client per LLM), not one process that speaks for everybody. Two LLMs must not be able to speak for each other's seat, each should hear back only about its own lines, and a seat should keep its persona without every line repeating it ("seat 2 uses persona ada", from the games brief).

Already true: `utterance`, `turn_started` and `turn_ended` carry a `seat_id`; pages filter by persona; the speech engine speaks one line at a time, which suits a table where one player talks at a time.

## Decision

An additive field on `hello`: a driver may list `seats`, each `{ seat_id, persona? }` (1 to 16). `protocol_version` stays 1.

- **One driver per seat.** Drivers for different seats connect together. A second driver for a seat that has one gets `driver_busy`. A driver that lists no seats is the driver of the whole table, as before, and cannot share the hub with a seat driver, either way round.
- **A seat driver may speak only for its seats.** `utterance`, `turn_started` and `turn_ended` for another seat, and `game_over` without its own `seat_id`, get `not_allowed`. It may cancel only its own lines; an id-less `cancel` stops only its own lines. The driver of the whole table and a controller still stop everything.
- **The seat's persona is filled in.** A line or turn from a seat driver that names no persona gets its seat's, so the existing persona-filtered pages and voices work with no change to the page. A persona named on the line wins. A seat bound to a persona the hub's personas file lacks is refused at `hello` (`unknown_persona`).
- **Each driver hears only its own lines.** The hub remembers which driver sent each line that is still in flight and sends `speech_started`, `speech_finished`, `speech_interrupted` and line errors to that driver. Reusing a line id that another driver has in flight is `bad_message`.
- **A driver leaving stops only its own lines.** The other seats keep speaking.

Only drivers list seats; a viewer or controller that does is refused (`bad_message`). Pages are unchanged: one page per persona still works, and the single-scene page that shows several seats is VIK-47.

## Alternatives considered

- **One driver for the whole table.** Works today, but then one process must hold every LLM's output and nothing stops one seat speaking for another.
- **A `seat_id` on the viewer's `hello`, filtering by seat.** Needed only by a page that shows one seat without a persona; the persona filter already does the job. VIK-47 may add it if the scene page wants it.
- **Seat bindings in the personas file.** A seat is a property of one match, not of a character, so the game says it when it connects.

## Consequences

- Several MCP servers or Python clients can drive one table. The Python client takes `seats=[...]`; the MCP seat parameter is VIK-48.
- The speech engine is still one voice at a time: two seats asked to speak together are spoken in turn. A table with true overlap would need more than one engine, which is not planned.
- `onDriverGone` now gets the ids of the departing driver's unfinished lines, and the engine stops those, not everything.
- The JSONL event log is unchanged and `vikaki replay` still sends a whole log as one driver.
