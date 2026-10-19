"""Spoken inner monologue (VIK-121): at the moments that matter a seat thinks aloud, in a soft voice that is plainly not table talk.

The thought is the one the model already wrote for the move (`think`); nothing here writes words. This module only decides *when* a thought is worth
saying aloud: an all-in, a big bet or call, a strong hand folded, and (after the hand) a showdown win, a big pot, or going broke. `--monologue
critical|all|off` picks how much: `critical` (the default) speaks only those, `all` every thought, `off` none (thoughts stay text in the panel).
"""

from __future__ import annotations

from dataclasses import dataclass, field

MODES = ("critical", "all", "off")
MAX_WORDS = 30  # a monologue is a beat, not a speech
STRONG_FOLD = 0.4  # folding with at least this chance to win is a hand worth a thought

# What the model is asked after a hand, for the moments nobody asks it for a move (the engine has nothing to decide there).
AFTER = {
    "win": "You just won the pot. What goes through your head?",
    "showdown": "You just lost at the showdown. What goes through your head?",
    "bust": "You just lost your last chip. What goes through your head?",
}


def critical_moment(view: dict, seat: str, action: str, amount: int | None, equity: float, big_blind: int) -> str | None:
    """Why this move is a moment worth a spoken thought, or None. `amount` is the raise-to total for a raise (as `Hand.act` takes it)."""
    me = next((p for p in view["players"] if p["seat_id"] == seat), None)
    if me is None:
        return None
    legal = view.get("legal") or {}
    if action == "fold":
        return "a strong hand folded" if equity >= STRONG_FOLD and legal.get("call_amount", 0) > 0 else None
    chips = legal.get("call_amount", 0) if action == "call" else max(0, (amount or 0) - me["bet"]) if action == "raise" else 0
    if chips <= 0:
        return None
    if chips >= me["stack"]:
        return "all-in"
    big = chips >= 6 * big_blind and chips * 2 >= view["pot"]
    return ("a big bet" if action == "raise" else "a big call") if big else None


def clip(text: str) -> str:
    """A thought as it is spoken: its first words, ending on the last whole sentence when it can."""
    words = text.split()
    if len(words) <= MAX_WORDS:
        return text
    cut = " ".join(words[:MAX_WORDS])
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: end + 1] if end > 20 else cut


@dataclass
class Monologue:
    """Which thoughts are spoken. A seat speaks at most once a hand (a table of people thinking aloud is noise)."""

    mode: str = "critical"
    _spoke: set[tuple[int, str]] = field(default_factory=set)

    def __post_init__(self) -> None:
        if self.mode not in MODES:
            raise ValueError(f"monologue must be one of {', '.join(MODES)}, got {self.mode!r}")

    def speaks(self, hand_no: int, seat: str, reason: str | None) -> bool:
        """Should this seat's thought be spoken now? `reason` is `critical_moment`'s answer (or the after-hand kind)."""
        if self.mode == "off" or (self.mode == "critical" and reason is None) or (hand_no, seat) in self._spoke:
            return False
        self._spoke.add((hand_no, seat))
        return True
