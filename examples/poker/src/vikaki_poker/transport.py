"""Pause, play and step (VIK-135): the page's control bar asks, and the game holds still between beats.

The runner calls `gate()` after every beat's pause. While paused it blocks there until `play` or `step` arrives: `step` lets exactly one more beat
through, then it holds again. A line being spoken is never cut off (the gate is between beats), and Ctrl-C still works (it waits in short turns).
`announce` is told whether the game is paused at every gate, so the page can show its controls and its state; the page shows what it asked for meanwhile.
"""

from __future__ import annotations

import threading
from typing import Callable


class Transport:
    def __init__(self, announce: Callable[[bool], None] | None = None) -> None:
        self._cv = threading.Condition()
        self.paused = False
        self._steps = 0
        self.announce = announce

    def handle(self, action: str) -> None:
        """A request from the page: `pause`, `play` or `step` (a step while running just pauses). Anything else is ignored."""
        with self._cv:
            if action == "pause":
                self.paused = True
            elif action == "play":
                self.paused = False
                self._steps = 0
            elif action == "step":
                if self.paused:
                    self._steps += 1
                else:
                    self.paused = True
            else:
                return
            self._cv.notify_all()
        # No announcement here: this runs on the connection's own thread, where sending would wait on itself. The next gate tells the pages.

    def gate(self) -> None:
        """Call between beats: returns at once when running, and when paused waits for a play or a step."""
        with self._cv:
            paused = self.paused
        self._tell(paused)
        with self._cv:
            while self.paused and self._steps == 0:
                self._cv.wait(0.2)  # short turns, so Ctrl-C is heard
            if self.paused and self._steps > 0:
                self._steps -= 1

    def _tell(self, paused: bool) -> None:
        if self.announce is not None:
            try:
                self.announce(paused)
            except Exception:  # noqa: BLE001 (the pages may be gone; the game goes on)
                pass
