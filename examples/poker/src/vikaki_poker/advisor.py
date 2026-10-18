"""Bots that play from the engine's facts alone, with no model (VIK-86): the rule of thumb the models are given, made into a player, and two weak
opponents to measure it against. They make a free, fast table for tests and for checking that the advice is sound, and they are what
`simulate` plays. Nothing here is used at the live table: a model there sees the same numbers and decides for itself.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .brain import turn_facts
from .hand import Hand
from .seat import Decision


@dataclass
class AdvisorBot:
    """Does what the rule of thumb says: raise for value (a bet of about two thirds of the pot), call when the price is right, fold when it is not."""

    seat_id: str
    persona: str = "advisor"
    samples: int = 300

    def decide(self, view: dict, talk: list | None = None, events: list | None = None, names: dict | None = None) -> Decision:
        legal = view["legal"]
        f = turn_facts(view, samples=self.samples)
        action = f["advice"]
        if action == "raise":
            to = int(view["current_bet"] + max(1, 0.67 * view["pot"]))
            return Decision("raise", max(legal["min_raise_to"], min(legal["max_raise_to"], to)))
        return Decision(action)


@dataclass
class CallingStation:
    """Never folds and never raises: checks when free, else calls. The classic weak opponent."""

    seat_id: str
    persona: str = "station"

    def decide(self, view: dict, talk: list | None = None, events: list | None = None, names: dict | None = None) -> Decision:
        return Decision("check" if "check" in view["legal"]["kinds"] else "call")


@dataclass
class RandomBot:
    """Picks a legal action at random (a raise to the minimum), with a seeded generator."""

    seat_id: str
    persona: str = "random"
    seed: int = 0
    _rng: random.Random = field(init=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def decide(self, view: dict, talk: list | None = None, events: list | None = None, names: dict | None = None) -> Decision:
        legal = view["legal"]
        kind = self._rng.choice(legal["kinds"])
        return Decision(kind, legal["min_raise_to"] if kind == "raise" else None)


def simulate(bots: dict[str, object], hands: int, *, stack: int = 200, small_blind: int = 1, big_blind: int = 2, seed: int = 0) -> dict[str, int]:
    """Deal `hands` hands among the bots, the button moving on each time and every stack set back to `stack`, and return each seat's net chips.
    The nets add up to zero: poker moves chips, it does not make them."""
    seats = list(bots)
    net = {s: 0 for s in seats}
    for n in range(hands):
        hand = Hand([(s, stack) for s in seats], n % len(seats), small_blind, big_blind, seed=seed * 100_003 + n)
        while not hand.complete:
            legal = hand.legal()
            assert legal is not None
            d = bots[legal.seat_id].decide(hand.view(legal.seat_id))  # type: ignore[attr-defined]
            hand.act(legal.seat_id, d.action, d.amount)
        for s, chips in hand.final_stacks().items():
            net[s] += chips - stack
    return net
