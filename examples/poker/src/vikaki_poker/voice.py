"""How the players sound (VIK-141): plain talk, not model-speak, and no word of the machinery behind their moves.

Two parts. `VOICE` is the short guide put in every prompt (adapted from the natural-writing rules for a card table). `clean` is the guard that does not
trust the prompt: models still reach for em dashes and for "the engine", so whatever they write is tidied before it is shown or spoken.
"""

from __future__ import annotations

import re

# What the seat's moves are called in its own head: never an engine, a system or a program.
HEAD = "your poker head"

VOICE = f"""How you sound: like a real person at a card table, not a narrator or an assistant.
- Plain words and contractions. Fragments are fine. Don't make every line the same length or open the same way.
- Never use dashes to set things off (no em dash and no en dash). Use a comma, a full stop, or start a new sentence.
- No stock phrases ("let's dive in", "it's worth noting", "I must say", "ultimately"), no hedging, no explaining the rules, and no announcing what you're about to do ("I will now call").
- Thoughts are quick and a bit messy, with an opinion in them, not a tidy summary. Talk about the hand like a player ("I'm behind", "coin flip", "they smell weak"), not like a report with percentages.
- {HEAD.capitalize()} is the careful, practised part of you that does the sums, and it has already settled your move each turn. Never call it an engine, a system, a program or an AI. When you go along with it, say it the way a person would: "doing the sensible thing", "playing it straight", "playing tight", "the responsible move", "playing it proper"."""

_DASHES = re.compile(r"\s*(?:[—–]|--+)\s*")
_ENGINE_POSSESSIVE = re.compile(r"\b(?:the|my|our|that|this)\s+(?:poker\s+|decision\s+|strategy\s+)?engine(?:'s|’s)\b", re.IGNORECASE)
_ENGINE = re.compile(r"\b(?:the|my|our|that|this)\s+(?:poker\s+|decision\s+|strategy\s+)?engine\b|\bengine\b", re.IGNORECASE)


def clean(text: str) -> str:
    """A line as it may be shown and spoken: dashes used as punctuation become commas, and "the engine" becomes "my head" (the guide says why)."""
    def swap(word: str):
        def sub(m: re.Match) -> str:
            start = m.start() == 0 or text[: m.start()].rstrip()[-1:] in ".!?\"'"  # at the head of a sentence it needs its capital
            return word.capitalize() if start else word
        return sub

    text = _ENGINE_POSSESSIVE.sub(swap("my head's"), text)
    text = _ENGINE.sub(swap("my head"), text)
    text = _DASHES.sub(", ", text)
    text = re.sub(r",\s*([.!?,;:])", r"\1", text)  # a dash before a stop leaves no stray comma
    return text.strip(" ,")
