"""How long the runner lets each beat of a hand sit on screen (VIK-113), so a viewer can follow: an action, a new street, the showdown, the win.

The times are what a person needs to see a thing happen and read it; `--pace slow|normal|fast|off` scales them (off for tests and dry runs).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

# Seconds at normal pace, by the kind of beat just shown.
SECONDS = {
    "new_hand": 3.0,  # the title card and the cards dealt
    "fold": 2.2,
    "check": 2.5,  # a check is a decision too: time for the others to look at the player and think about it (VIK-134)
    "call": 2.8,
    "raise": 3.4,
    "street": 3.2,  # the bets swept in and the next cards turned over
    "showdown": 3.5,  # the hands turned over
    "win": 4.0,  # the pot slid to the winner
    "monologue": 1.2,  # a thought spoken aloud: a longer pause after it, so it is heard as a thought and not run into the next line (VIK-121)
}

# A bet or call that puts in a lot sits longer, up to this many seconds more at the biggest (an all-in), so the others have more to think about.
WEIGHT_SECONDS = 2.0
WEIGHTED = ("call", "raise")

PACES = {"off": 0.0, "fast": 0.5, "normal": 1.0, "slow": 1.5}


@dataclass
class Pace:
    scale: float = 0.0
    sleep: Callable[[float], None] = time.sleep
    gate: Callable[[], None] | None = None  # called after every beat's pause: where a paused game holds still (VIK-135)

    def wait(self, kind: str, weight: float = 0.0) -> None:
        """Pause after a beat. `weight` (0 to 1) is how big a call or raise was against the pot: the bigger, the longer."""
        seconds = (SECONDS.get(kind, 0.0) + (WEIGHT_SECONDS * min(1.0, max(0.0, weight)) if kind in WEIGHTED else 0.0)) * self.scale
        if seconds > 0:
            self.sleep(seconds)
        if self.gate is not None:
            self.gate()
