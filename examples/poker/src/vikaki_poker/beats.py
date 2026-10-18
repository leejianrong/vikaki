"""The beats of a hand as the page shows them (VIK-113): an `event` for `table_state` with the words, so the page draws them and knows no poker.

Each is a dict with a `kind` (what to animate), usually a `seat_id` and `amount`, and `text`, the banner.
"""

from __future__ import annotations

from typing import Any

from .facts import hand_name
from .hand import Hand


def _who(seat_id: str, names: dict[str, str]) -> str:
    return names.get(seat_id, seat_id).capitalize()


def _with(hand: str) -> str:
    """"pair of aces" as "a pair of aces", "flush, ace high" as "a flush, ace high": the hand as it follows "with"."""
    if hand.startswith(("two pair", "three of", "four of", "ace high", "king high", "queen high", "jack high")) or hand.endswith(" high") and "," not in hand:
        return hand
    return f"an {hand}" if hand[0] in "aeiou" else f"a {hand}"


def action_event(e: dict, names: dict[str, str]) -> dict[str, Any]:
    """From an action in `Hand.events` (a fold, check, call or raise)."""
    kind, seat = e["type"], e["seat_id"]
    who = _who(seat, names)
    event: dict[str, Any] = {"kind": kind, "seat_id": seat}
    if kind == "fold":
        event["text"] = f"{who} folds"
    elif kind == "check":
        event["text"] = f"{who} checks"
    elif kind == "call":
        event.update(amount=e["amount"], text=f"{who} calls {e['amount']}")
    else:
        event.update(amount=e["amount"], text=f"{who} goes all in for {e['amount']}" if e.get("all_in") else f"{who} raises to {e['amount']}")
    return event


def new_hand_event(number: int) -> dict[str, Any]:
    return {"kind": "new_hand", "text": f"Hand {number}"}


def street_event(street: str) -> dict[str, Any]:
    return {"kind": "street", "text": street.capitalize()}


def showdown_event() -> dict[str, Any]:
    return {"kind": "showdown", "text": "Showdown"}


def win_event(hand: Hand, names: dict[str, str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The win of a finished hand: the event, and the `winners` (seat, amount, and the hand's name when the cards were shown)."""
    winners: list[dict[str, Any]] = []
    parts: list[str] = []
    for e in hand.events:
        if e["type"] != "win":
            continue
        seat = e["seat_id"]
        w: dict[str, Any] = {"seat_id": seat, "amount": e["amount"]}
        said = f"{_who(seat, names)} wins {e['amount']}"
        if e.get("showdown"):
            w["hand"] = hand_name(list(hand.player(seat).hole), list(hand.board))
            said += f" with {_with(w['hand'])}"
        winners.append(w)
        parts.append(said)
    first = winners[0]
    return {"kind": "win", "seat_id": first["seat_id"], "amount": first["amount"], "text": " · ".join(parts)}, winners
