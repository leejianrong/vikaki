# ADR-0022: The engine briefs the players: facts and a guide from the engine, a personality from the table file

- Status: Accepted (Jian asked for smarter, more interesting players, 2026-10-18; VIK-86)
- Date: 2026-10-18
- Deciders: Jian, Claude

## Context

The first real run (ADR-0018, DeepSeek V4.1 flash, three seats) played legal poker and dull poker. The prompt gave a seat its cards, the pot, the stacks and "play to win, but keep the table light and kind", and nothing else: no idea what its hand was worth, what a call cost against the pot, who had raised, or how a player of its character would play. The models checked, folded and called. Two persona notes ("careful worrier", "quick to fold") made it worse.

ADR-0018 already says models miscount and invent cards, so the engine tells them what is true. This extends that from "the cards and chips" to "what they mean".

## Decision

Each turn a seat is briefed by three things, none of them a model call.

1. **A short guide to playing well** in the system prompt (about 250 words: position, starting hands, chance to win against the price of a call, betting for value, discounting a raised pot, bluffing, short stacks). The same for every seat.
2. **The facts of this turn, worked out by the engine** (`facts.py`, `brain.py`): the hand in words ("pair of kings"), the chance to win against random hands (exact or sampled, seeded by the situation so a turn is repeatable), pot odds and what the call needs, cards that would improve the hand, position, a preflop tier, stack-to-pot ratio, the story of the hand so far street by street with the characters' names, and a one-line **rule-of-thumb recommendation with its reason**. The seat is told to follow it or break from it when its personality or the story says so. Only what the seat may know goes in: never another seat's cards.
3. **A personality from the table file** (`traits` on a seat): six numbers from 0 to 1 (talkative, loose, aggressive, bluff, tricky, emotional) and a free-text quirk, turned into concrete instructions ("bluff about 6 times in 10 when nobody has bet", "play about 45 hands in every 100", "you slow-play monsters", "say something nearly every turn"). The traits sit in the table file, not the hub's personas file: a character's look and voice belong to the avatar, how it plays belongs to the game.

The personalities are archetypes drawn from how real players are known to play (the showman who narrates, the careful rock who apologises while setting traps, the fearless gambler), never impersonations. The prompt also forbids echoing another player's catchphrase or repeating a phrase, which the first try did (a seat repeated "Benny boy" every turn, another copied "squint").

Around it:

- **`stats.py`** counts how each seat actually played (VPIP, PFR, aggression, folds, lines and words per move) and the command prints it, so "do the personalities show" is a number and not an impression.
- **Rebuys by default**: a player who goes broke buys back in, so a session of twenty hands is twenty hands (`--no-rebuy` for a tournament).
- **Bots without a model** (`advisor.py`): the rule of thumb as a player, a calling station and a random bot, with `simulate`. They exist to check the advice is sound and to give tests a free table; the live table never uses them.
- The 7-card evaluator is now computed directly rather than by trying all 21 fives (about 10 times quicker, identical to the old one on 7500 random hands and the awkward cases), because the sampling calls it a million times.

## Evidence

- The rule-of-thumb bot against a calling station and a random bot, 400 hands, blinds 1 and 2: +5349 and +7366 chips over two seeds (about +13 to +18 chips a hand), the others losing. A sanity check against weak opponents, not a claim of strength.
- Twenty real hands with three DeepSeek V4.1 flash seats (about 4 cents): tight Ben played 25% of hands before the flop and folded 75%, the two loose seats 90 to 100% and raised half of the time, and the talk matched the traits (a commentator, an apologiser, a gambler).

## Alternatives considered

- **Only a longer prompt** (a strategy essay). Cheap, but the model still has to estimate its chances, and it does so badly and slowly; the engine does it exactly.
- **Only an advisor** (the engine decides, the model talks). Predictable and strong, and as dull as the fixed opponent it would be: no bluffs, no personality. The seat should be able to disagree.
- **Per-character prompts written by hand.** Prose is not comparable between seats and cannot be measured; numbers can, and `stats.py` shows what they did.
- **Reasoning on.** Tried with the first run: the reasoning ate the token cap and thinking is dead air at a table. Off by default (VIK-80).

## Consequences

- A turn's prompt is longer (about 1.1k input tokens a call, about a fifth of a cent). The run above cost about 4 cents for 206 calls.
- The numbers assume random opponent hands and the guide says to discount them against a raise; it is a rule of thumb, not solved poker.
- A personality is guidance a model may ignore. The stats are how we notice.
