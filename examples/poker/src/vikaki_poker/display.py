"""What the table page shows of a hand: the engine's truth, turned into a `table_state` message (ADR-0018, VIK-59, VIK-61).

The page draws exactly what it is sent and knows no poker, so what a spectator may see is decided here. Hole cards are sent face down (`back`)
until a showdown turns the hands that are still in face up; `show_cards` turns every live hand face up all the time, for watching how an
LLM bluffs. A folded hand is never shown.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from .facts import equity, hand_name
from .hand import Hand


@lru_cache(maxsize=128)
def _win_chances(holes: tuple[tuple[str, tuple[str, ...]], ...], board: tuple[str, ...]) -> dict[str, float]:
    """Each live seat's chance to win, cached: it costs half a second, and the same hands and board are shown after every move of a street."""
    return equity({seat: list(cards) for seat, cards in holes}, list(board))


def _last_action(hand: Hand, seat_id: str) -> str | None:
    """What a seat did last in the words of a spectator ("raised to 12"), or None if it has not acted yet (blinds are not actions)."""
    for e in reversed(hand.events):
        if e.get("seat_id") != seat_id or e["type"] == "blind":
            continue
        kind = e["type"]
        if kind == "fold":
            return "folded"
        if kind == "check":
            return "checked"
        if kind == "call":
            return f"called {e['amount']}"
        if kind == "raise":
            return ("all in, " if e.get("all_in") else "") + f"raised to {e['amount']}"
    return None


def table_state(hand: Hand, *, show_cards: bool = False, event: dict[str, Any] | None = None, hand_no: int | None = None, winners: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The keyword arguments of `VikakiClient.table_state` for this moment of `hand`. `event` is the beat just played (VIK-113), `hand_no` which hand this
    is and `winners` who took the pot, once it has been paid (VIK-94): all for the page to show, and none of them about the cards."""
    done = hand.complete
    street = ("showdown" if hand.showdown else "complete") if done else "showdown" if hand.showdown else hand.street
    seats = []
    spectating = (show_cards or hand.showdown) and all(p.hole for p in hand.seats)
    live = [(p.seat_id, tuple(p.hole)) for p in hand.seats if not p.folded and p.hole]
    chances = _win_chances(tuple(live), tuple(hand.board)) if spectating and len(live) >= 2 else {}
    for p in hand.seats:
        face_up = not p.folded and (show_cards or hand.showdown)
        seat: dict[str, Any] = {"seat_id": p.seat_id, "stack": p.stack}
        if p.bet:
            seat["bet"] = p.bet
        if p.folded:
            seat["folded"] = True
        seat["cards"] = list(p.hole) if face_up and p.hole else ["back"] * len(p.hole)
        # The words and the odds are only sent when the cards are: they would give a hidden hand away.
        if face_up and p.hole:
            seat["hand"] = hand_name(list(p.hole), list(hand.board))
            if p.seat_id in chances:
                seat["win"] = round(chances[p.seat_id], 4)
        last = _last_action(hand, p.seat_id)
        if last:
            seat["action"] = last
        seats.append(seat)
    state: dict[str, Any] = {
        "seats": seats,
        "pot": 0 if done else hand.pot,  # once complete the pot has been paid into the stacks
        "street": street,
        "board": list(hand.board),
        "dealer": hand.seats[hand.button].seat_id,
    }
    if hand.to_act is not None:
        state["turn"] = hand.to_act
    if event is not None:
        state["event"] = event
    if hand_no is not None:
        state["hand_no"] = hand_no
    if winners:
        state["winners"] = winners
    return state
