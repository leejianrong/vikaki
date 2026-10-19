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


def _straight_high(ranks: set[int]) -> int:
    """The high card of the best straight in a set of ranks (the ace also plays low), or 0."""
    low = ranks | {1} if 14 in ranks else ranks
    for high in range(14, 4, -1):
        if all(high - i in low for i in range(5)):
            return high
    return 0


def best_five(cards: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    """The five cards that make the best hand out of five to seven (VIK-94), for the page to highlight. The first five found win a tie."""
    return max(combinations(cards, 5), key=score_five)


def best_score(cards: list[str] | tuple[str, ...]) -> Score:
    """The best five-card score among five to seven cards. Worked out directly from the counts of ranks and suits (about ten times quicker than
    trying every five of seven: the win-probability sampling calls it a million times); `score_five` over every five is the reference it must equal."""
    if not 5 <= len(cards) <= 7:
        raise ValueError(f"need five to seven cards, got {len(cards)}")
    ranks = [rank_value(c) for c in cards]
    counts = Counter(ranks)
    suit_counts = Counter(c[1] for c in cards)
    flush_suit = next((suit for suit, n in suit_counts.items() if n >= 5), None)
    if flush_suit is not None:
        flush = sorted((rank_value(c) for c in cards if c[1] == flush_suit), reverse=True)
        high = _straight_high(set(flush))
        if high:
            return (8, (high,))
    groups = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    top, top_n = groups[0]
    if top_n == 4:
        return (7, (top, max(r for r in ranks if r != top)))
    if top_n == 3:
        pairs = [r for r, n in counts.items() if r != top and n >= 2]
        if pairs:
            return (6, (top, max(pairs)))
    if flush_suit is not None:
        return (5, tuple(flush[:5]))
    high = _straight_high(set(ranks))
    if high:
        return (4, (high,))
    if top_n == 3:
        return (3, (top, *sorted((r for r in ranks if r != top), reverse=True)[:2]))
    pairs = sorted((r for r, n in counts.items() if n == 2), reverse=True)
    if len(pairs) >= 2:
        return (2, (pairs[0], pairs[1], max(r for r in ranks if r != pairs[0] and r != pairs[1])))
    if pairs:
        return (1, (pairs[0], *sorted((r for r in ranks if r != pairs[0]), reverse=True)[:3]))
    return (0, tuple(sorted(ranks, reverse=True)[:5]))


def describe(score: Score) -> str:
    return CATEGORIES[score[0]]
