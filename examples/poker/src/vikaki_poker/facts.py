"""What is true about a hand, computed by the engine so a model does not have to guess (VIK-82, ADR-0018: "models miscount chips and invent cards").

Win probabilities (exact when few boards are left, else sampled), the name of a hand in words, outs, pot odds, position and a rule-of-thumb
recommendation. Pure and deterministic given a seed. Nothing here talks to a model or the network.
"""

from __future__ import annotations

import random
from itertools import combinations
from math import comb

from .cards import RANKS, full_deck, rank_value
from .evaluate import CATEGORIES, best_score

RANK_NAMES = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "jack", 12: "queen", 13: "king", 14: "ace"}
PLURALS = {**{r: n + "s" for r, n in RANK_NAMES.items()}, 6: "sixes"}
EXACT_BOARDS = 1500  # enumerate every way to finish the board when there are at most this many; otherwise sample


def _name(rank: int) -> str:
    return RANK_NAMES[rank]


def hand_name(hole: list[str], board: list[str]) -> str:
    """A hand in words: "pair of kings", "ace-king suited", "flush, ace high". With no board it describes the two hole cards."""
    if len(hole) != 2:
        raise ValueError("a hand has two hole cards")
    if not board:
        a, b = sorted((rank_value(c) for c in hole), reverse=True)
        if a == b:
            return f"pocket {PLURALS[a]}"
        return f"{_name(a)}-{_name(b)} {'suited' if hole[0][1] == hole[1][1] else 'offsuit'}"
    if len(board) < 3:
        raise ValueError("a board is empty or has at least three cards")
    score = best_score(list(hole) + list(board))
    kind, ranks = score
    if kind == 8:
        return "royal flush" if ranks[0] == 14 else f"straight flush, {_name(ranks[0])} high"
    if kind == 7:
        return f"four of a kind, {PLURALS[ranks[0]]}"
    if kind == 6:
        return f"full house, {PLURALS[ranks[0]]} over {PLURALS[ranks[1]]}"
    if kind == 5:
        return f"flush, {_name(ranks[0])} high"
    if kind == 4:
        return f"straight, {_name(ranks[0])} high"
    if kind == 3:
        return f"three of a kind, {PLURALS[ranks[0]]}"
    if kind == 2:
        return f"two pair, {PLURALS[ranks[0]]} and {PLURALS[ranks[1]]}"
    if kind == 1:
        return f"pair of {PLURALS[ranks[0]]}"
    return f"{_name(ranks[0])} high"


def _unseen(known: list[str]) -> list[str]:
    seen = set(known)
    return [c for c in full_deck() if c not in seen]


def equity(holes: dict[str, list[str]], board: list[str], *, rng: random.Random | None = None, samples: int = 1500) -> dict[str, float]:
    """Each seat's share of the pot if everyone in `holes` (all still in the hand, all cards known) goes to the showdown: the chance to win,
    plus a share of the ties. Exact when the board can be finished in few enough ways, else sampled."""
    need = 5 - len(board)
    seats = list(holes)
    deck = _unseen([c for h in holes.values() for c in h] + list(board))
    wins = {s: 0.0 for s in seats}

    def settle(extra: tuple[str, ...]) -> None:
        full = list(board) + list(extra)
        scores = {s: best_score(list(holes[s]) + full) for s in seats}
        top = max(scores.values())
        winners = [s for s in seats if scores[s] == top]
        for s in winners:
            wins[s] += 1 / len(winners)

    if need == 0:
        settle(())
        return dict(wins)
    if comb(len(deck), need) <= EXACT_BOARDS:
        total = 0
        for extra in combinations(deck, need):
            settle(extra)
            total += 1
    else:
        rng = rng or random.Random(0)
        total = samples
        for _ in range(samples):
            settle(tuple(rng.sample(deck, need)))
    return {s: w / total for s, w in wins.items()}


def equity_vs_random(hole: list[str], board: list[str], opponents: int, *, rng: random.Random | None = None, samples: int = 1200) -> float:
    """The chance a hand wins (ties counted by share) against `opponents` players holding random cards: what a seat can work out without seeing anyone's
    cards. It flatters a hand that is facing a big bet, because a player who bets big is not holding random cards."""
    if opponents < 1:
        return 1.0
    rng = rng or random.Random(0)
    deck = _unseen(list(hole) + list(board))
    need = 5 - len(board)
    total = 0.0
    for _ in range(samples):
        drawn = rng.sample(deck, need + 2 * opponents)
        full = list(board) + drawn[:need]
        mine = best_score(list(hole) + full)
        theirs = [best_score(drawn[need + 2 * i : need + 2 * i + 2] + full) for i in range(opponents)]
        top = max(theirs)
        if mine > top:
            total += 1
        elif mine == top:
            total += 1 / (1 + sum(1 for t in theirs if t == top))
    return total / samples


def improving_cards(hole: list[str], board: list[str]) -> int | None:
    """Unseen cards that would improve the hand's category on the next card (flop and turn only; None otherwise). It counts cards that
    make a better kind of hand, so a pair that becomes two pair counts and a better kicker does not."""
    if len(board) not in (3, 4):
        return None
    now = best_score(list(hole) + list(board))[0]
    return sum(1 for c in _unseen(list(hole) + list(board)) if best_score(list(hole) + list(board) + [c])[0] > now)


def pot_odds(call_amount: int, pot: int) -> float:
    """The win probability a call must have to break even: what it costs against what is in the pot after it. 0 when it costs nothing."""
    return 0.0 if call_amount <= 0 else call_amount / (pot + call_amount)


def position(seat_ids: list[str], button: str, seat: str) -> str:
    """Where a seat sits, by the dealer button: "button", "small blind", "big blind" (three or more players), or for two players "button / small blind"."""
    n = len(seat_ids)
    i = (seat_ids.index(seat) - seat_ids.index(button)) % n
    if n == 2:
        return "button / small blind" if i == 0 else "big blind"
    if i == 0:
        return "button"
    if i == 1:
        return "small blind"
    if i == 2:
        return "big blind"
    return "early position" if i <= n // 2 else "late position"


def preflop_strength(hole: list[str]) -> tuple[int, str]:
    """A rough tier for two hole cards, 1 (premium) to 5 (weak), and a word for it, by the Chen score. Good for a nudge, not for a verdict."""
    ranks = sorted((rank_value(c) for c in hole), reverse=True)
    hi, lo = ranks
    score = {14: 10, 13: 8, 12: 7, 11: 6}.get(hi, hi / 2)
    if hi == lo:
        score = max(5, score * 2)
    else:
        if hole[0][1] == hole[1][1]:
            score += 2
        gap = hi - lo - 1
        score -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
        if gap <= 1 and hi < 12:
            score += 1
    if score >= 10:
        return 1, "premium"
    if score >= 8:
        return 2, "strong"
    if score >= 6:
        return 3, "playable"
    if score >= 4:
        return 4, "marginal"
    return 5, "weak"


def advice(*, win: float, call_amount: int, pot: int, can_check: bool, can_raise: bool, opponents: int) -> tuple[str, str]:
    """A recommended action and the reason, from the win probability against random hands and the pot odds. A rule of thumb: the persona decides
    how closely to follow it. Returns (action, reason) with the action one of fold, check, call, raise."""
    need = pot_odds(call_amount, pot)
    # Against more players, the same hand is worth less than its win chance suggests it will be when called.
    value_bar = min(0.8, 0.5 + 0.08 * max(0, opponents - 1))
    pct = f"{win:.0%}"
    if call_amount <= 0:
        if can_raise and win >= value_bar:
            return "raise", f"you win {pct} of the time against random hands and nothing is owed: bet for value"
        return "check", f"nothing is owed and you win {pct}: take the free card" if win >= 0.3 else f"nothing is owed and you win only {pct}: check"
    if win >= value_bar + 0.1 and can_raise:
        return "raise", f"you win {pct} and a call needs only {need:.0%}: raise for value"
    if win >= need + 0.05:
        return "call", f"you win {pct}, more than the {need:.0%} the call needs"
    if win >= need - 0.03:
        return "call", f"close: you win {pct} and the call needs {need:.0%}, so it is a marginal call"
    return "fold", f"you win only {pct} and the call needs {need:.0%}"
