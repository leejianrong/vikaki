# ADR-0042: Our own CFR, for short-stack push/fold and the heads-up river

- Status: Accepted (VIK-123)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

The engine (ADR-0026) prices moves by arithmetic: a few hundred random finishes against ranges guessed from the betting. It is sound and fast and not game-theory optimal, and it was never meant to be (`strategy.py`). Two kinds of spot are small enough to solve properly: a short stack, where the game is all in or fold, and the last street between two players. The best open solver for the second is AGPL, which this Apache-2.0 repository cannot take, so the work is our own.

## Decision

- **`cfr.py`**: CFR+ (regrets floored at zero, strategies averaged with weights that grow with the iteration), generic over a small two-player game, checked on Kuhn poker: the game's value (-1/18), the known family of equilibria and an exploitability near 0.
- **`river.py`**: a heads-up river solver in vector form (one walk of the tree for every holding at once). Out of position and in position, bets of half and of the whole pot, a shove over a bet, and no other raise; the showdown is priced with sorted strengths and prefix sums with card removal, so 150 holdings a side and 100 iterations take about 1.6 s. Checked against the textbook polar-range game (the nuts bet, bluffs half as many as the nuts, the bluff-catcher calls half the time) and by its own exploitability.
- **`pushfold.py`** with `data/equity169.json` and `data/pushfold.json`: charts for a table of three and for two at 2 to 20 big blinds, solved by CFR+ on the strategy of each of the 169 hand classes (`tools/gen_equity.py` and `tools/gen_pushfold.py` make the files, with fixed seeds; 165 KB and 87 KB). Chip value only; each class dealt independently of the others (no card removal); a two-way all-in uses the measured class-against-class equity, a three-way one 1.2 times the product of the two-way chances; nobody limps. CFR+ on three players reaches a coarse correlated equilibrium, which in push/fold is very close to Nash: a test holds that no class gains more than a few hundredths of a big blind by switching.
- **`solver.py`** puts them at the table, and only when asked (`--solver`, `SeatAgent.solver`, `decide(solver=True)`): the chart answers a short stack (20 big blinds or fewer) at three or two players, before anyone has done more than shove, fold or call a shove; the river solver answers heads-up on the river, with the ranges `opponents.py` guesses for both players from the betting they both saw, following the betting so far down the tree (a bet within 30% of a size the tree has counts as that size; anything else is left to the engine). Either returns a `Move`, or None, and then `decide` carries on as before. A mixed answer is played by a seeded roll, so a seeded game replays.
- The engine still decides every move (ADR-0026): the solvers are two more of its means, and no trait reaches them (ADR-0030).

## Checked

Unit tests at every layer, mutations (the three-way factor, the depth limit, the tree's size rule) and a duplicate match of the solver seat against the engine seats (`tools/strength.py --table solver,engine,engine`), in the status row.

## Not done

Positions beyond three players, stacks over 20 big blinds before the flop, and ICM. A table of more than three solves nothing before the flop: the engine plays it. The river solver is heads-up and a few seconds a decision, so it is off by default. Preflop and flop solving (the full game) is far bigger than this.
