# ADR-0043: The commentator is a voice on a budget, never a seat

- Status: Accepted (VIK-110)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

VIK-109 left the hooks: the table voices have a level, and `kind: commentary` has its own strip. Someone has to say the lines. Jian commentates himself for now; this is the stretch goal of an AI doing it, on a table that already talks plenty.

## Decision

- `commentary.py` in the poker example: a `Commentator` the runner asks at each beat of a hand. It speaks only at moments: the opening of the first hand and now and then (every fifth), each street, an all-in or a big bet, the showdown and the win.
- **A talk budget.** At most 3 lines a hand (`--commentary-budget`), one kept for the result so the hand always ends on it, at least 2 beats apart (the result is exempt). A new hand starts a new budget.
- **Only what the audience sees.** The model is given the board, the pot, the stacks, the bets and the spectator numbers the page already shows (a hand's name and chance to win, when the cards are shown); a face-down card is never in the facts (a test). Lines are one or two sentences, at most 28 words, tidied by `voice.clean` (no dashes, no "engine").
- **Never over a player.** The runner does one thing at a time and the hub speaks one line at a time, so the commentator speaks between beats, after the move's banner and before the pause; a test holds that no commentary falls inside a seat's turn.
- **Its own voice.** The persona `desk` (last in the example personas files, so `?seats=N` takes the players first), on its own connection and a seat called `commentator`, `kind: commentary`: the page puts it in its own strip, no avatar speaks it, and the table-voices level applies (ADR-0040).
- **A broken model never leaves it silent.** With no model (`--fake-llm`) or when the call fails, a template says the beat plainly. The model is `commentary_model` in the table file, else the reaction model, else the first seat's.
- Off by default (`--commentary`): it costs a model call a line and a persona on the hub.

## Not done

A lower-third or an avatar for the commentator, reacting to what an audience member said, and the commentator following the camera. It does not see anyone's hidden cards, so it cannot comment on a bluff as a bluff: only on what is shown.
