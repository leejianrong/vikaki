"""How long the runner lets each beat of a hand sit on screen (VIK-113), so a viewer can follow: an action, a new street, the showdown, the win.

The times are what a person needs to see a thing happen and read it; `--pace slow|normal|fast|off` scales them (off for tests and dry runs).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

# Seconds at normal pace, by the kind of beat just shown.
SECONDS = {
    "new_hand": 2.5,  # the title card and the cards dealt
    "fold": 1.75,
    "check": 1.75,
    "call": 1.75,
    "raise": 1.75,
    "street": 2.5,  # the bets swept in and the next cards turned over
    "showdown": 3.0,  # the hands turned over
    "win": 3.5,  # the pot slid to the winner
}

PACES = {"off": 0.0, "fast": 0.5, "normal": 1.0, "slow": 1.5}


@dataclass
class Pace:
    scale: float = 0.0
    sleep: Callable[[float], None] = time.sleep

    def wait(self, kind: str) -> None:
        seconds = SECONDS.get(kind, 0.0) * self.scale
        if seconds > 0:
            self.sleep(seconds)
