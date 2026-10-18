"""Hand ranges (VIK-118): sets of two-card holdings, ranked by strength, so the engine can reason about what an opponent is likely to hold.

A range is a list of combos (two cards each). Before the flop hands are ranked by how often their class wins against a random hand (`PREFLOP_ORDER`,
made by `rank_classes`); after it, by the hand they make with the board, with a nudge so that strong draws rank with a pair, since a bet may be one.
`narrow` keeps the top share of a range, and `percentiles` says where each combo stands in it (0 is the strongest), which is how the engine decides who
would continue against a bet of a given size.
"""

from __future__ import annotations

import random
from functools import lru_cache
from itertools import combinations

from .cards import RANKS, SUITS, full_deck, rank_value
from .evaluate import best_score
from .preflop_ranking import PREFLOP_ORDER

Combo = tuple[str, str]
TOTAL_COMBOS = 1326


def class_of(a: str, b: str) -> str:
    """"AA", "AKs" or "AKo": the class of a holding, ignoring which suits."""
    hi, lo = sorted((a, b), key=lambda c: rank_value(c), reverse=True)
    if hi[0] == lo[0]:
        return hi[0] + lo[0]
    return hi[0] + lo[0] + ("s" if hi[1] == lo[1] else "o")


@lru_cache(maxsize=1)
def all_combos() -> tuple[Combo, ...]:
    return tuple(combinations(full_deck(), 2))  # type: ignore[arg-type]


@lru_cache(maxsize=1)
def _by_class() -> dict[str, tuple[Combo, ...]]:
    out: dict[str, list[Combo]] = {}
    for c in all_combos():
        out.setdefault(class_of(*c), []).append(c)
    return {k: tuple(v) for k, v in out.items()}


@lru_cache(maxsize=1)
def _class_index() -> dict[str, int]:
    return {name: i for i, name in enumerate(PREFLOP_ORDER)}


def rank_classes(samples: int = 3000, seed: int = 1) -> list[str]:
    """The 169 classes from strongest to weakest by their chance to win against one random hand. This is how `PREFLOP_ORDER` was made (it is a constant so
    that the engine does not spend seconds on it each time it starts); a test checks the table still looks like this."""
    rng = random.Random(seed)
    strength: dict[str, float] = {}
    for name, combos in _by_class().items():
        wins = 0.0
        for _ in range(samples):
            mine = rng.choice(combos)
            deck = [c for c in full_deck() if c not in mine]
            drawn = rng.sample(deck, 7)
            theirs, board = drawn[:2], drawn[2:]
            a, b = best_score(list(mine) + board), best_score(theirs + board)
            wins += 1.0 if a > b else 0.5 if a == b else 0.0
        strength[name] = wins / samples
    return sorted(strength, key=lambda k: strength[k], reverse=True)


def top_share(share: float, dead: frozenset[str] = frozenset()) -> list[Combo]:
    """The strongest `share` (0 to 1) of all starting hands, without any that use a dead card."""
    want = max(1, round(share * TOTAL_COMBOS))
    out: list[Combo] = []
    for name in PREFLOP_ORDER:
        for c in _by_class()[name]:
            if c[0] not in dead and c[1] not in dead:
                out.append(c)
        if len(out) >= want:
            break
    return out


def _draws(combo: Combo, board: list[str]) -> bool:
    """A flush draw (four to a flush with a hole card in it) or an open-ended straight draw: a hand that may be betting for what it could become."""
    if not 3 <= len(board) <= 4:
        return False
    cards = list(combo) + board
    for suit in SUITS:
        if sum(1 for c in cards if c[1] == suit) == 4 and any(c[1] == suit for c in combo):
            return True
    ranks = {rank_value(c) for c in cards}
    if 14 in ranks:
        ranks.add(1)
    mine = {rank_value(c) for c in combo} | ({1} if any(c[0] == "A" for c in combo) else set())
    for low in range(2, 11):  # four in a row that can be completed at either end
        run = set(range(low, low + 4))
        if run <= ranks and run & mine:
            return True
    return False


# What a draw is worth when ranking: about a middling pair, so a range that bets includes some draws.
_DRAW_KEY = (1, (9, 8, 7, 6))


def board_key(combo: Combo, board: list[str]):
    """Strength of a holding on a board, for ranking: its best hand, but a strong draw counts as a middling pair if it is not already better."""
    s = best_score(list(combo) + board)
    if s[0] < 1 and _draws(combo, board):
        return _DRAW_KEY
    return s


def _ordered(combos: list[Combo], board: list[str] | None) -> list[Combo]:
    """Strongest first."""
    if board:
        return sorted(combos, key=lambda c: board_key(c, board), reverse=True)
    index = _class_index()
    return sorted(combos, key=lambda c: index[class_of(*c)])


def narrow(combos: list[Combo], share: float, board: list[str] | None = None) -> list[Combo]:
    """The strongest `share` of `combos` (at least one combo is kept, unless there are none)."""
    if not combos:
        return []
    keep = max(1, round(share * len(combos)))
    return _ordered(combos, board)[:keep]


def percentiles(combos: list[Combo], board: list[str] | None = None) -> dict[Combo, float]:
    """Where each combo stands in the range: the share of the range that is stronger (0 is the strongest). Combos of equal strength share a value."""
    if not combos:
        return {}
    ordered = _ordered(combos, board)
    keyfn = (lambda c: board_key(c, board)) if board else (lambda c: _class_index()[class_of(*c)])
    out: dict[Combo, float] = {}
    n = len(ordered)
    i = 0
    while i < n:
        j = i
        while j < n and keyfn(ordered[j]) == keyfn(ordered[i]):
            j += 1
        for c in ordered[i:j]:
            out[c] = i / n
        i = j
    return out
