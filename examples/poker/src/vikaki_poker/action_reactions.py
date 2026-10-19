"""How the others take a move (VIK-134): after a player acts, everyone still in the hand reacts silently while the move sits on screen.

No model and no randomness that is not seeded: a big raise or an all-in worries or startles the table, a big call raises eyebrows, and a small move
draws nothing (the table's gaze at the player and the pause are the reaction). The page turns every head toward the player who acted (`table-page.ts`);
this adds the faces. A reaction is a garnish and never stalls the table.
"""

from __future__ import annotations

import random

from .reactions import Reaction

BIG = 0.6  # a raise or call this share of the pot or more is a big one


def weight_of(kind: str, amount: int | None, pot_before: int, all_in: bool) -> float:
    """How big a call or raise was, against the pot before it, from 0 to 1 (an all-in is 1). Other moves weigh nothing."""
    if kind not in ("call", "raise"):
        return 0.0
    if all_in:
        return 1.0
    return min(1.0, max(0.0, (amount or 0) / max(pot_before, 1)))


def reaction_to(kind: str, weight: float, all_in: bool, listener: str, hand_no: int) -> Reaction | None:
    """How `listener` takes a move of this kind and weight, or None to stay still. The same hand and seat always react the same way."""
    rng = random.Random(f"{hand_no}:{listener}:{kind}")
    if all_in:
        return Reaction("surprised", rng.choice(("shake", "tilt")), 2.6)
    if kind == "raise" and weight >= BIG:
        return Reaction(rng.choice(("worried", "surprised")), "tilt", 2.2)
    if kind == "raise":
        return Reaction("worried", None, 1.6) if rng.random() < 0.5 else None
    if kind == "call" and weight >= BIG:
        return Reaction("surprised", "nod", 1.8)
    return None
