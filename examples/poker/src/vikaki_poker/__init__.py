"""A small, pure Texas Hold'em engine for the Vikaki example table (ADR-0018). No network, no LLM, no avatar: just the rules."""

from .cards import full_deck, shuffled_deck
from .evaluate import best_score, describe
from .hand import Hand, IllegalAction, Legal

__all__ = ["Hand", "IllegalAction", "Legal", "best_score", "describe", "full_deck", "shuffled_deck"]
