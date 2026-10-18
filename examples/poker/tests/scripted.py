"""A stand-in for the decision engine in tests that need to choose the moves: it reads the "action" (and "amount") out of the same scripted replies the
fake model gives, in the same order, and makes them legal the way a tolerant reader would. Production never reads an action from a model (ADR-0026)."""

from __future__ import annotations

import json

from vikaki_poker.seat import _json_object
from vikaki_poker.strategy import Move


def engine_from(replies):
    state = {"n": 0}

    def engine(view, events, *, big_blind, rng, samples):
        text = replies[state["n"] % len(replies)] if not callable(replies) else ""
        state["n"] += 1
        obj = _json_object(text) or {}
        legal = view["legal"]
        kinds = legal["kinds"]
        action = str(obj.get("action", "")).strip().lower().replace("-", "_")
        action = {"bet": "raise", "all_in": "raise", "allin": "raise"}.get(action, action)
        if action == "call" and "check" in kinds:
            action = "check"
        if action not in kinds:
            return Move("check" if "check" in kinds else "fold", None, "scripted: not legal here")
        amount = None
        if action == "raise":
            raw = obj.get("amount", legal["min_raise_to"])
            try:
                amount = int(float(raw))
            except (TypeError, ValueError):
                amount = legal["min_raise_to"]
            amount = max(legal["min_raise_to"], min(legal["max_raise_to"], amount))
        return Move(action, amount, "scripted")

    return engine


def always(kind: str, amount: int | None = None):
    """An engine that always does the same thing when it can (and checks or folds when it cannot)."""

    def engine(view, events, *, big_blind, rng, samples):
        kinds = view["legal"]["kinds"]
        if kind not in kinds:
            return Move("check" if "check" in kinds else "fold", None, "scripted")
        if kind == "raise":
            legal = view["legal"]
            return Move("raise", max(legal["min_raise_to"], min(legal["max_raise_to"], amount or legal["min_raise_to"])), "scripted")
        return Move(kind, None, "scripted")

    return engine
