"""What each opponent may be holding, from what they did in this hand (VIK-118).

Everyone starts with any two cards. Each action narrows their range: before the flop a raise is a strong range and a re-raise a stronger one, a call
is a middling one, a small all-in is a wide one; after it a bet or raise keeps the stronger part of what was left, a call a little more, a check
nothing. The shares are rules of thumb, in `SHARES`, and every one of them is where a better model could be put in. Only what a seat could see is
used: the actions, never anyone's cards.
"""

from __future__ import annotations

from .ranges import Combo, all_combos, narrow, top_share

# Share of all starting hands a player has when they act so. Postflop shares are of the range they had.
SHARES = {
    "open_raise": 0.38,
    "three_bet": 0.14,
    "four_bet": 0.06,
    "limp": 0.60,
    "call_raise": 0.32,
    "call_three_bet": 0.16,
    "short_shove": 0.35,  # an all-in for 12 big blinds or fewer is a wide range, not a strong one
    "bet": 0.40,
    "call": 0.62,
}
SHORT_STACK_BB = 12
STREET_CARDS = {"flop": 3, "turn": 4, "river": 5}


def estimate_ranges(view: dict, events: list[dict], hero: str, big_blind: int) -> dict[str, list[Combo]]:
    """The range of each opponent still in the hand, without the cards the hero can see (its own and the board)."""
    board = view["board"]
    dead = frozenset(view["hole"]) | frozenset(board)
    live = [p["seat_id"] for p in view["players"] if not p["folded"] and p["seat_id"] != hero]
    ranges: dict[str, list[Combo]] = {s: list(all_combos()) for s in live}
    raises = 0
    for e in events:
        kind = e["type"]
        if kind not in ("fold", "check", "call", "raise"):
            continue
        seat = e["seat_id"]
        preflop = e["street"] == "preflop"
        if seat in ranges:
            if preflop and kind == "raise":
                share = SHARES["open_raise"] if raises == 0 else SHARES["three_bet"] if raises == 1 else SHARES["four_bet"]
                if e.get("all_in") and e["amount"] <= SHORT_STACK_BB * big_blind:
                    share = max(share, SHARES["short_shove"])
                ranges[seat] = [c for c in ranges[seat] if c in set(top_share(share))] or ranges[seat]
            elif preflop and kind == "call":
                share = SHARES["limp"] if raises == 0 else SHARES["call_raise"] if raises == 1 else SHARES["call_three_bet"]
                ranges[seat] = [c for c in ranges[seat] if c in set(top_share(share))] or ranges[seat]
            elif not preflop and kind in ("raise", "call"):
                seen = board[: STREET_CARDS.get(e["street"], len(board))]
                alive = [c for c in ranges[seat] if c[0] not in seen and c[1] not in seen]
                ranges[seat] = narrow(alive, SHARES["bet"] if kind == "raise" else SHARES["call"], seen)
        if preflop and kind == "raise":
            raises += 1
    return {s: [c for c in r if c[0] not in dead and c[1] not in dead] for s, r in ranges.items()}
