"""Cards are two-character strings: a rank (`23456789TJQKA`) then a suit (`shdc`), so the ace of spades is `"As"`."""

from __future__ import annotations

import random

RANKS = "23456789TJQKA"
SUITS = "shdc"


def full_deck() -> list[str]:
    """The 52 cards in a fixed order."""
    return [r + s for s in SUITS for r in RANKS]


def shuffled_deck(seed: int | None = None) -> list[str]:
    """A shuffled deck. The same seed gives the same order."""
    deck = full_deck()
    random.Random(seed).shuffle(deck)
    return deck


def rank_value(card: str) -> int:
    """2 to 14, the ace being 14."""
    return RANKS.index(card[0]) + 2


def validate(card: str) -> str:
    if len(card) != 2 or card[0] not in RANKS or card[1] not in SUITS:
        raise ValueError(f"not a card: {card!r}")
    return card
