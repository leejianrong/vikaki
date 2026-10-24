"""Buying back in (VIK-108): what the table does with a player who has gone broke.

The policy is one of `auto` (a broke player is dealt back in with a fresh stack at once), `ask` (the audience may ask for it with a button on the seat's card, and the
game grants the request at the next hand) and `never` (a broke player is out). Requests arrive on a connection's own thread, so they are kept under a lock.
"""

from __future__ import annotations

import threading

POLICIES = ("auto", "ask", "never")


def policy_of(value: str | bool | None) -> str:
    """A policy from what a caller passed: a name, or the old yes/no (`True` is `auto`, `False` is `never`)."""
    if value is None or value is True:
        return "auto"
    if value is False:
        return "never"
    if value not in POLICIES:
        raise ValueError(f"rebuy must be one of {', '.join(POLICIES)}, got {value!r}")
    return value


class Rebuys:
    def __init__(self, policy: str | bool | None = "auto") -> None:
        self.policy = policy_of(policy)
        self._asked: set[str] = set()
        self._cv = threading.Condition()

    def request(self, seat_id: str) -> None:
        """The audience asked for a seat to buy back in. Ignored unless the policy is `ask`."""
        if self.policy != "ask":
            return
        with self._cv:
            self._asked.add(seat_id)
            self._cv.notify_all()

    def grant(self, busted: list[str]) -> list[str]:
        """Of the seats that are broke, the ones to deal back in now. Requests for seats that are not broke are dropped: they are stale."""
        with self._cv:
            asked, self._asked = self._asked, set()
        if self.policy == "auto":
            return list(busted)
        if self.policy == "ask":
            return [s for s in busted if s in asked]
        return []

    def wait(self, seconds: float) -> bool:
        """Wait up to `seconds` for a request; whether one has come."""
        with self._cv:
            if not self._asked:
                self._cv.wait(seconds)
            return bool(self._asked)
