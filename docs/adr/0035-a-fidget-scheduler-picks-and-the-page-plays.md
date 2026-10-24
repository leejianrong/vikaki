# ADR-0035: A scheduler picks the fidgets and the page plays them

- Status: Accepted (VIK-103)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

VIK-102 made a seat glance round the room on its own timer. The cards after it (peek at the cards, restack chips, tap, lean, stretch, scratch) must share one body: two at once would fight, a fidget must give way to a line or a reaction, and a character's temperament should change how much it moves.

## Decision

- `fidgets.ts` (pure, seeded) is a small state machine per seat: wait, run one fidget for its length, wait. The wait is 7 to 16 s divided by `0.5 + fidgety` (so a calm seat waits about 14 to 32 s and a restless one 5 to 11 s), and by 2.2 while the seat thinks.
- It picks by weight (look 5, peek 3, restack 2, tap, lean, scratch 1, stretch 0.7, in the order of value in the roadmap), with a cooldown per kind, never the same kind twice running (unless it is the only one that may), and boosts peek and tap while thinking.
- A fidget may be left out for a seat: one the page cannot play yet (each card switches its own on), one needing arms that bend when the avatar's cannot (**no fake with a nod**: the reaching fidgets are simply not chosen for it, unlike a decision, which must show), one needing cards in hand or chips in front when the seat has none, and `look` when nothing in the den is in reach.
- A seat does not start a fidget, and drops the one it is in, when it speaks, looks at whoever speaks, or plays a gesture or a decision (`Puppet.busy`). A fidget is below all of those.
- **How restless a seat is comes from the game.** `table_state` seats carry an optional `fidgety` from 0 to 1 (additive, protocol version stays 1). The poker example works it out from the traits: `0.7 * emotional + 0.3 * talkative`. The page knows no traits, only this number; absent means 0.5.
- `look-around.ts` keeps what a glance is (`Glancer`); the timing moved here.

## Not done

Only `look` is played so far. Peek (VIK-104), restack (VIK-105) and the idle extras (VIK-106) switch themselves on in the scheduler's `enabled` set as they land.
