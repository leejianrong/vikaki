# ADR-0026: A decision engine picks the move; a model only performs it

- Status: Accepted (Jian: the players are not good at poker, and personalities must not steer play; VIK-118, VIK-119)
- Date: 2026-10-19
- Deciders: Jian, Claude

## Context

The models chose the moves, from a briefing and a rule of thumb (ADR-0022). They played timidly, shoved because a quirk said "loves an all-in", and could be talked into anything. The rule of thumb compared a hand's chance against *random* cards with the pot odds, which ignores what an opponent's actions say about their hand.

## Decision

The move comes from an engine with no model and no personality in it (`strategy.py`, with `ranges.py` and `opponents.py`):

1. **Ranges.** Each opponent's possible holdings are narrowed by their actions in the hand: a raise is the best 38% of hands before the flop, a re-raise the best 14%, a call something in between, a small all-in a wide range; after the flop a bet or raise keeps the stronger 40% of what was left (a strong draw counts as a pair), a call 62%, a check nothing. Preflop hands are ranked by their simulated chance against a random hand (`PREFLOP_ORDER`, made by `ranges.rank_classes`).
2. **Pricing.** A few hundred random finishes are played with each opponent holding a hand from their range. From them it prices fold (0), call or check, and raises of several sizes (preflop opens and re-raises in big blinds, postflop bets of half, three quarters and the whole pot, and a shove for a short stack), in chips won or lost from now on. A raise wins the pot when everyone folds; an opponent folds the weaker part of their range in proportion to the size of the bet (the share at which a bluff breaks even), times `FOLD_DISCOUNT`, and the hero's hand is measured against those who stay.
3. **Choice.** The best-priced move, with a 30% chance of a nearly-as-good one that does not lose chips against folding. Bluffs and semi-bluffs come out of the prices; nothing is a rule.

Nothing in the decision knows who the player is: `strategy.decide(view, events, big_blind, rng)`. A model is asked only to speak and think about a move it has been told (VIK-119), so personality, quirks and talk cannot change what a seat does, which a test will assert (identical decisions for any traits).

## Measured

`tools/strength.py` deals many hands between bots with every deal played in every seat rotation (duplicate poker, so the luck of the cards cancels) and reports big blinds won per 100 hands. One engine against two rule-of-thumb players (the old `AdvisorBot`):

| Assumed folding (`FOLD_DISCOUNT`) | 100 big blinds | 25 big blinds |
| --- | --- | --- |
| 0.8 (first guess) | +76 (±47) | |
| 0.5 (chosen) | +260 (±43) | +63 (±14) |
| 0.3 | +246 (±44) | |
| 0.0 (never assume a fold) | +276 (±45) | |

900 deals each (2700 hands). The first guess at 0.8 lost its edge by bluffing at players who rarely fold; a plain 4000-hand run without duplication could not tell the engine from the rule of thumb (±45). Against a calling station and a random bot it wins about +820, as the rule of thumb did, so that is not a useful yardstick. 0.5 keeps some bluffing for variety at little cost against these opponents, and does not matter for a table of engines, where nothing is exploiting anything.

## Not done, and why

- It does not model future streets (no implied odds, no reasoning about what it will do on the next card), reads opponents only from this hand (no memory of how a player behaved earlier), and treats all opponents alike. These are the next places to improve it.
- Solved push/fold tables and a heads-up river solver (CFR) are VIK-123. Full CFR on 3-handed no-limit is out of reach; the best open solvers are AGPL, so any solver here is our own.

## Consequences

A decision takes about 50 to 150 ms. The moves are sound and the same for every seat; the character is in the talk.
