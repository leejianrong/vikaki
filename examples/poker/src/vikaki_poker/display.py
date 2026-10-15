"""What the table page shows of a hand: the engine's truth, turned into a `table_state` message (ADR-0018, VIK-59, VIK-61).

The page draws exactly what it is sent and knows no poker, so what a spectator may see is decided here. Hole cards are sent face down (`back`)
until a showdown turns the hands that are still in face up; `show_cards` turns every live hand face up all the time, for watching how an
LLM bluffs. A folded hand is never shown.
"""

from __future__ import annotations

from typing import Any

from .hand import Hand


def table_state(hand: Hand, *, show_cards: bool = False) -> dict[str, Any]:
    """The keyword arguments of `VikakiClient.table_state` for this moment of `hand`."""
    done = hand.complete
    street = ("showdown" if hand.showdown else "complete") if done else hand.street
    seats = []
    for p in hand.seats:
        face_up = not p.folded and (show_cards or hand.showdown)
        seat: dict[str, Any] = {"seat_id": p.seat_id, "stack": p.stack}
        if p.bet:
            seat["bet"] = p.bet
        if p.folded:
            seat["folded"] = True
        seat["cards"] = list(p.hole) if face_up and p.hole else ["back"] * len(p.hole)
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
    return state
