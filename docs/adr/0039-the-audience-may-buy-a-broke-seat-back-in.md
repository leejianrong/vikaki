# ADR-0039: The audience may buy a broke seat back in

- Status: Accepted (VIK-108)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

A cash game rebuys a broke player on the spot, which is dull to watch: nothing is at stake in being out. A tournament ends too soon. Jian wanted the audience to decide.

## Decision

- A policy, `--rebuy auto|ask|never` (replacing `--no-rebuy`, which stays as a hidden alias for `never`): `auto` is what the game did before, `never` ends a player's game, and **`ask` leaves a broke seat out until the audience asks**.
- The request is a viewer message `audience_request` (`kind: rebuy`, `seat_id`), additive, protocol version still 1. The table says what it takes: `table_state` carries `rebuy` (`ask`, `auto` or `never`; absent is never) and each seat may carry `out` (out of chips and out of the game: **not** merely all in, which also has a stack of 0 mid-hand, so the game sets `out` only once the pot is paid or for a seat that sat the hand out).
- The hub keeps whether the last `table_state` said `ask`, passes a request to every driver only then, and otherwise drops it quietly. The game decides: the poker runner grants a request at the next hand for a seat that is still broke, drops stale ones (the seat is not broke) and ignores them under `auto` and `never`.
- The page shows a "Buy back in" button on the card of a seat that is `out` while the policy is `ask`; it reads "Asked" and cannot be pressed twice until the seat is back.
- With `ask`, a table that has dropped to one player waits up to 15 s for a request before it ends (`rebuy_wait`; the library default is no wait, so tests and scripts are not slowed).
- The Python client sends `rebuy` on `table_state` and gives `audience_request` to `on_event` listeners like any event; the poker voice listens on one connection (the hub sends it to all).
- A busted seat sat out is listed in `table_state` with a stack of 0, `out` and the action "out of chips", so the page keeps its card.

## Checked

At the protocol (shape, who may send), the hub (only while asked, to every driver), the runner (never, ask without a click, ask with a click, the wait, stale and ignored requests, the table state) and the page (button only while asked and out, a click reaches the driver, "Asked").
