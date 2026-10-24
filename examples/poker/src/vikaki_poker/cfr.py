"""Counterfactual regret minimisation, written for this table (VIK-123): CFR+ with linear averaging.

The solvers that exist are large and some are AGPL; this is a small one of our own, for two jobs, a river solver (`river.py`) and short-stack push/fold
charts (`pushfold.py`). This file is what they share and the generic scalar form, which is checked on Kuhn poker (a three-card game whose equilibrium is
known: the first player loses 1/18 of a bet a hand).

CFR+ keeps the regret of an action at or above zero (so a bad early action is not buried under a mountain of negative regret), plays each action in
proportion to its regret, and averages the strategies of the iterations with a weight that grows with the iteration, which is what makes the average
converge. The average strategy is the answer; the current one is not.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Callable, Sequence


def regret_matching(regrets: Sequence[float]) -> list[float]:
    """A strategy from regrets: each action in proportion to its positive regret, and all alike when none is positive."""
    total = 0.0
    for r in regrets:
        if r > 0:
            total += r
    n = len(regrets)
    if total <= 0:
        return [1.0 / n] * n
    return [r / total if r > 0 else 0.0 for r in regrets]


@dataclass
class InfoSet:
    """What one player knows at one decision, with the regrets and the running strategy sum of its actions."""

    n: int
    regret: list[float] = field(default_factory=list)
    strategy_sum: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.regret = [0.0] * self.n
        self.strategy_sum = [0.0] * self.n

    def strategy(self) -> list[float]:
        return regret_matching(self.regret)

    def average(self) -> list[float]:
        total = sum(self.strategy_sum)
        return [s / total for s in self.strategy_sum] if total > 0 else [1.0 / self.n] * self.n


class Game:
    """A two-player zero-sum game with chance, for the generic solver. Subclasses describe it by states, which are any hashable or plain objects.

    `chance(state)` returns `[(probability, next_state), ...]` for a chance node, else None. `terminal(state)` returns the first player's payoff, else None.
    `player(state)` is 0 or 1 at a decision. `actions(state)` names the moves; `info(state)` is what the player to act knows (a hashable key); `play(state, action)`
    is the state after it.
    """

    def start(self):  # pragma: no cover - interface
        raise NotImplementedError

    def chance(self, state):  # pragma: no cover
        return None

    def terminal(self, state) -> float | None:  # pragma: no cover
        return None

    def player(self, state) -> int:  # pragma: no cover
        raise NotImplementedError

    def actions(self, state) -> Sequence[str]:  # pragma: no cover
        raise NotImplementedError

    def info(self, state):  # pragma: no cover
        raise NotImplementedError

    def play(self, state, action: str):  # pragma: no cover
        raise NotImplementedError


class Solver:
    """CFR+ on a `Game`, walking the whole tree each iteration (fine for games of a few hundred states). `solve(n)` runs n iterations and returns the game's value for player 0."""

    def __init__(self, game: Game) -> None:
        self.game = game
        self.sets: dict[object, InfoSet] = {}
        self.iterations = 0

    def _set(self, key, n: int) -> InfoSet:
        s = self.sets.get(key)
        if s is None:
            s = self.sets[key] = InfoSet(n)
        return s

    def _walk(self, state, traverser: int, reach: tuple[float, float, float]) -> float:
        """The value to `traverser` of `state`. `reach` is (the chance, player 0's, player 1's) probability of getting here."""
        g = self.game
        t = g.terminal(state)
        if t is not None:
            return t if traverser == 0 else -t
        outcomes = g.chance(state)
        if outcomes is not None:
            return sum(p * self._walk(nxt, traverser, (reach[0] * p, reach[1], reach[2])) for p, nxt in outcomes)
        who = g.player(state)
        acts = g.actions(state)
        info = self._set((who, g.info(state)), len(acts))
        sigma = info.strategy()
        if who == traverser:
            values = [self._walk(g.play(state, a), traverser, reach) for a in acts]
            ev = sum(s * v for s, v in zip(sigma, values))
            opp = reach[0] * reach[2 if traverser == 0 else 1]  # what everyone else contributes to reaching here
            for i, v in enumerate(values):
                info.regret[i] = max(0.0, info.regret[i] + opp * (v - ev))  # CFR+: regrets never go below zero
            mine = reach[1 if traverser == 0 else 2]
            weight = max(1, self.iterations)  # linear averaging: later iterations count more
            for i, s in enumerate(sigma):
                info.strategy_sum[i] += weight * mine * s
            return ev
        total = 0.0
        for s, a in zip(sigma, acts):
            r = list(reach)
            r[1 if who == 0 else 2] *= s
            total += s * self._walk(g.play(state, a), traverser, (r[0], r[1], r[2]))
        return total

    def solve(self, iterations: int) -> float:
        value = 0.0
        for _ in range(iterations):
            self.iterations += 1
            value = self._walk(self.game.start(), 0, (1.0, 1.0, 1.0))
            self._walk(self.game.start(), 1, (1.0, 1.0, 1.0))
        return value

    def average(self, who: int, info) -> list[float]:
        return self.sets[(who, info)].average()

    def exploitability(self) -> float:
        """How much a player who knew our average strategy could win from it, per hand, summed over both seats, in the game's units: 0 is a perfect equilibrium.
        Found by trying every pure strategy of the other seat, so it is for small games (the tests', not the river's)."""
        avg = {k: s.average() for k, s in self.sets.items()}
        return sum(self._best_response(who, avg) for who in (0, 1))

    def _info_sets(self, who: int) -> dict[object, int]:
        """Every information set of `who` and how many actions it has."""
        g = self.game
        found: dict[object, int] = {}

        def walk(state) -> None:
            if g.terminal(state) is not None:
                return
            out = g.chance(state)
            if out is not None:
                for _, nxt in out:
                    walk(nxt)
                return
            acts = g.actions(state)
            if g.player(state) == who:
                found[(who, g.info(state))] = len(acts)
            for a in acts:
                walk(g.play(state, a))

        walk(g.start())
        return found

    def _best_response(self, who: int, avg: dict) -> float:
        from itertools import product

        g = self.game
        sets = self._info_sets(who)
        keys = list(sets)

        def value(pure: dict) -> float:
            def walk(state) -> float:
                t = g.terminal(state)
                if t is not None:
                    return t if who == 0 else -t
                out = g.chance(state)
                if out is not None:
                    return sum(p * walk(nxt) for p, nxt in out)
                acts = g.actions(state)
                p = g.player(state)
                if p == who:
                    return walk(g.play(state, acts[pure[(p, g.info(state))]]))
                sigma = avg.get((p, g.info(state)), [1.0 / len(acts)] * len(acts))
                return sum(s * walk(g.play(state, a)) for s, a in zip(sigma, acts) if s > 0)

            return walk(g.start())

        return max(value(dict(zip(keys, choice))) for choice in product(*[range(sets[k]) for k in keys]))


class Kuhn(Game):
    """Kuhn poker: three cards, J, Q and K, one dealt to each player, an ante of 1, and bets of 1. A player may pass (`p`) or bet (`b`); a pass after a bet
    folds. Its value for the first player is -1/18 of a bet a hand, and the equilibrium is known (the first player bets a J a third of the time as a bluff and
    always bets a K when he bets at all in the mixed family): the test is that the solver finds the value and an exploitability near 0."""

    def start(self):
        return ()

    def chance(self, state):
        if len(state) == 0:
            return [(1 / 6, (a, b, "")) for a in "JQK" for b in "JQK" if a != b]
        return None

    def terminal(self, state):
        if len(state) != 3:
            return None
        a, b, hist = state
        if hist == "bp":
            return 1.0  # the second player folded to a bet
        if hist == "pbp":
            return -1.0  # the first player folded to a bet
        if hist in ("pp", "bb", "pbb"):
            stake = 1.0 if hist == "pp" else 2.0
            return stake if "JQK".index(a) > "JQK".index(b) else -stake
        return None

    def player(self, state):
        return len(state[2]) % 2

    def actions(self, state):
        return ("p", "b")

    def info(self, state):
        return (state[0] if self.player(state) == 0 else state[1], state[2])

    def play(self, state, action):
        return (state[0], state[1], state[2] + action)
