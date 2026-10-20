# ADR-0029: The page reviews, and the game holds still between beats

- Status: Accepted (VIK-135)
- Date: 2026-10-20
- Deciders: Jian, Claude

## Context

Jian wanted pause, play and step forward and back, to look again at key moments of a hand.

## Decision

- **Two halves.** *Reviewing* is the page's: it keeps every `table_state` it has been sent (`state-history.ts`, 500 at most) and stepping back redraws an older one with no motion and no sound, while newer states pile up behind it unshown. *Holding the game* is the game's: the runner blocks at a gate between beats.
- **Protocol (additive).** `transport` (`pause`, `play`, `step`) goes viewer to hub to every driver (a table of seat drivers has no single one); `transport_state` (`paused`) goes driver to viewers. The page shows its bar only after it has heard `transport_state`, so a game that cannot be paused gets no dead controls. The game sends the state at every beat, so a page that joins late learns it.
- **The gate** (`transport.py`, called by `Pace.wait` after each beat's pause): returns at once when running; paused, it waits for `play` or `step` (one beat, then it holds again). A line being said is never cut off, and Ctrl-C still works.
- **Stepping back pauses the game** (so it does not run on while you look); Play returns the page to the newest state and the game to running; Step forward while reviewing moves through the held-back states (with motion and sound), and at the newest while paused asks the game for one beat.

## Consequences

- Pause takes effect at the next beat, not mid-line, which is the right place for a spectator.
- The page's state shown while it waits for the game's answer is optimistic; the game's next `transport_state` corrects it.
- History is states only: the chat and thoughts panels are logs and are left as they are while reviewing.
