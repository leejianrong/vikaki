"""Hand ranking: the best five cards out of five to seven. A higher score is a better hand, and equal scores split the pot."""

from __future__ import annotations

from collections import Counter
from itertools import combinations

from .cards import rank_value

CATEGORIES = ["high card", "pair", "two pair", "three of a kind", "straight", "flush", "full house", "four of a kind", "straight flush"]

Score = tuple[int, tuple[int, ...]]


def score_five(cards: tuple[str, ...]) -> Score:
    ranks = sorted((rank_value(c) for c in cards), reverse=True)
    flush = len({c[1] for c in cards}) == 1
    # Group by how many of each rank, biggest group first, then by rank: a full house of 9s over 4s is (9, 4).
    groups = sorted(Counter(ranks).items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    counts = [n for _, n in groups]
    ordered = tuple(r for r, _ in groups)
    straight_high = 0
    if len(groups) == 5:
        if ranks[0] - ranks[4] == 4:
            straight_high = ranks[0]
        elif ranks == [14, 5, 4, 3, 2]:  # the wheel: the ace plays low, so the high card is the five
            straight_high = 5
    if straight_high and flush:
        return (8, (straight_high,))
    if counts == [4, 1]:
        return (7, ordered)
    if counts == [3, 2]:
        return (6, ordered)
    if flush:
        return (5, tuple(ranks))
    if straight_high:
        return (4, (straight_high,))
    if counts == [3, 1, 1]:
        return (3, ordered)
    if counts == [2, 2, 1]:
        return (2, ordered)
    if counts == [2, 1, 1, 1]:
        return (1, ordered)
    return (0, tuple(ranks))


def best_score(cards: list[str] | tuple[str, ...]) -> Score:
    """The best five-card score among five to seven cards."""
    if not 5 <= len(cards) <= 7:
        raise ValueError(f"need five to seven cards, got {len(cards)}")
    return max(score_five(five) for five in combinations(cards, 5))


def describe(score: Score) -> str:
    return CATEGORIES[score[0]]
