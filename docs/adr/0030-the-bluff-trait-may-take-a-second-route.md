# ADR-0030: The bluff trait may take a second route; no other trait touches the move

- Status: Accepted (Jian approved relaxing ADR-0026 for `bluff` only; VIK-139)
- Date: 2026-10-22
- Deciders: Jian, Claude

## Context

ADR-0026 made the move the engine's alone, and a test proved personality could not change it. That made every seat play the same, so a "bluffy" character never bluffed and its talk had nothing to be about. Jian wanted a character that really bluffs now and then, with the model's words and thoughts fitting it, without letting the model choose moves.

## Decision

1. **Two routes.** `strategy.decide` still returns the proper move (today's best-priced one). When that move is a check or a fold it also carries `bluff_route`: the best-priced raise sized like a bluff, half to three quarters of the pot (the pot plus what is owed), up to a pot on a scary board (a pair, three of a suit, or three close ranks: `scary_board`). A preflop shove is never a bluff. The route is dropped when it costs more than `BLUFF_MAX_COST` (0.25) of the pot against the proper move.
2. **The trait picks the route.** `take_route(move, bluff, rng)`: a seat takes the route with probability `BLUFF_RATE` (0.6) times its `bluff` trait, rolled on the seat's own seeded dice and only when a route exists, so a seeded game replays. Trait 0 never bluffs.
3. **The model is told.** The briefing says "You are bluffing here" and asks for words that fit and never give it away; the model still chooses nothing (`Decision.bluffing` records it).
4. **Only `bluff`.** `test_whatever_the_personality_the_move_is_the_same` keeps every other trait and the quirk out of the move (it now sets `bluff` equal in both seats); `test_only_the_bluff_trait_may_bend_the_move_and_a_seeded_game_replays` shows `bluff` alone does, replayably.

## Measured

`tools/strength.py --hands 900` (duplicate deals, one `bluffer` against two rule-of-thumb players; `BLUFF=<trait>`), in big blinds won per 100 hands, ± one standard error:

| `BLUFF_MAX_COST` | trait | 100 bb | 25 bb |
| --- | --- | --- | --- |
| (plain engine, no route) | | +262 (±43) | +63 (±14) |
| 0.5 (first guess) | 0.5 | +207 (±48) | +35 (±16) |
| 0.5 | 1.0 | +103 (±53) | -15 (±18) |
| 0.1 | 0.5 / 1.0 | +254 (±44) / +255 (±44) | |
| 0.25 (chosen) | 0.5 | +269 (±46) | +62 (±15) |
| 0.25 | 1.0 | +257 (±48) | +45 (±16) |

The first guess lost a lot: bluffing into a fold-heavy spot with a costly raise. Capping the extra cost at a quarter of the pot makes the loss disappear into the noise at 100 bb (the default trait, 0.5, loses nothing measurable) and costs about 18 bb/100 at the extreme trait 1.0 at 25 bb, one standard error. Against engines that never exploit anything it matters even less. Rare moves: the route exists in a minority of check and fold spots, and the engine's own arithmetic already bluffs when it prices well.

## Consequences

`bluff` is the only trait that reaches the move; `loose`, `aggressive`, `tricky`, `emotional`, `talkative` and the quirk still cannot. Scripted engines in tests have no route and are unchanged. Re-measure after changing `BLUFF_*` constants.
