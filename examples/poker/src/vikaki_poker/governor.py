"""The talk governor (VIK-92): a quiet table, whatever the models do. Talk is for information or banter, not narration.

The `talkative` trait becomes a budget (words in a line, turns of silence after speaking, one line a street). The prompt tells the seat
the budget; the governor enforces it: a line over budget is dropped, not trimmed (half a sentence is worse than none), and the reason is
returned so the log notes it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .brain import Traits


@dataclass(frozen=True)
class TalkBudget:
    max_words: int  # the longest line allowed
    cooldown: int  # turns of the seat's own that must pass in silence after it speaks


QUIET, MIDDLING, CHATTY = TalkBudget(10, 2), TalkBudget(14, 1), TalkBudget(20, 1)  # Jian: Ada talked a bit too much and Ben too little (VIK-119)


def budget_for(talkative: float) -> TalkBudget:
    return QUIET if talkative < 0.34 else CHATTY if talkative > 0.66 else MIDDLING


@dataclass
class Governor:
    _turns: dict[str, int] = field(default_factory=dict)  # a seat's turns so far, over the whole session
    _spoke: dict[str, int] = field(default_factory=dict)  # the turn on which it last spoke
    _street: dict[str, tuple[int, str]] = field(default_factory=dict)  # the (hand, street) in which it last spoke

    def vet(self, seat: str, hand_no: int, street: str, say: str, traits: Traits) -> tuple[str, str]:
        """Call once per turn. Returns what may be said (empty when nothing, or dropped) and a note saying why a line was dropped."""
        turn = self._turns[seat] = self._turns.get(seat, 0) + 1
        if not say:
            return "", ""
        b = budget_for(traits.talkative)
        words = len(say.split())
        if words > b.max_words:
            return "", f"line dropped: {words} words, the budget is {b.max_words}"
        if self._street.get(seat) == (hand_no, street):
            return "", "line dropped: already spoke this street"
        last = self._spoke.get(seat)
        if last is not None and turn - last <= b.cooldown:
            return "", f"line dropped: cooldown ({b.cooldown} turns)"
        self._spoke[seat] = turn
        self._street[seat] = (hand_no, street)
        return say, ""
