"""Silent reactions: how a seat that is listening feels about a line it just heard (ADR-0018, VIK-58).

A reaction is an emotion and perhaps a nod, shake or tilt, sent as a `react` event. It costs no audio and does not wait in the speech queue behind
whoever is talking. Two reactors decide them: `MirrorReactor` follows a fixed table of how listeners tend to answer an emotion (free, and
the same every time), and `LlmReactor` asks a cheap model, one short call per listener. A reactor that cannot decide, or whose model fails,
answers `None`: a reaction is a garnish and never stalls the table.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from .llm import Llm, LlmError, Usage
from .seat import EMOTIONS, _json_object

GESTURES = ("nod", "shake", "tilt")


@dataclass
class Reaction:
    emotion: str | None = None  # one of EMOTIONS, or None for a gesture alone
    gesture: str | None = None  # one of GESTURES, or None
    seconds: float | None = None  # how long the feeling is held; the page's default when None


class Reactor(Protocol):
    def react(self, listener: str, speaker: str, text: str, emotion: str | None) -> Reaction | None:
        """How `listener` feels about `speaker` saying `text` (in `emotion`, if the speaker showed one). None to stay still."""
        ...


# How a listener tends to answer what a speaker's face showed. Neutral speech draws no reaction: most lines pass without one.
ANSWERS: dict[str, Reaction] = {
    "smug": Reaction("worried", "tilt"),
    "happy": Reaction("happy", "nod"),
    "worried": Reaction("worried", "nod"),
    "sad": Reaction("sad", "tilt"),
    "angry": Reaction("surprised", "shake"),
    "surprised": Reaction("surprised", "tilt"),
}


class MirrorReactor:
    """No model: answer the speaker's emotion from `ANSWERS`. Free, instant and repeatable, so it is what the dry run and the tests use."""

    def react(self, listener: str, speaker: str, text: str, emotion: str | None) -> Reaction | None:
        if listener == speaker:
            return None
        return ANSWERS.get(emotion or "")


SYSTEM = """You are {persona}, a friendly cartoon character at a poker table, listening to another player. Character: {style}
Show a quick, silent reaction to what you just heard, with your face and head only. Reply with ONLY one JSON object:
{{"emotion": "<one of: {emotions}>", "gesture": "nod" | "shake" | "tilt" | "none"}}
Use "neutral" and "none" when it would not move you."""


def parse_reaction(text: str) -> Reaction | None:
    """Read a reply. Anything unreadable, or neutral with no gesture, is None. Never raises."""
    obj = _json_object(text)
    if obj is None:
        return None
    emotion = obj.get("emotion") if obj.get("emotion") in EMOTIONS and obj.get("emotion") != "neutral" else None
    gesture = obj.get("gesture") if obj.get("gesture") in GESTURES else None
    return Reaction(emotion, gesture) if emotion or gesture else None


@dataclass
class LlmReactor:
    """Ask a cheap `model` how each listener feels. `seats` maps a seat id to `(persona, style)`; the usage of every call is kept in `usage`."""

    llm: Llm
    model: str
    seats: dict[str, tuple[str, str]]
    max_tokens: int = 40
    usage: Usage = field(default_factory=Usage)

    def react(self, listener: str, speaker: str, text: str, emotion: str | None) -> Reaction | None:
        if listener == speaker:
            return None
        persona, style = self.seats.get(listener, (listener, ""))
        heard = f"{self.seats.get(speaker, (speaker, ''))[0]} just said: \"{text}\"" + (f" (looking {emotion})." if emotion else ".")
        messages = [
            {"role": "system", "content": SYSTEM.format(persona=persona, style=style or "friendly", emotions=", ".join(EMOTIONS))},
            {"role": "user", "content": heard},
        ]
        try:
            reply = self.llm.complete(messages, model=self.model, max_tokens=self.max_tokens)
        except LlmError:
            return None
        self.usage.add(reply.usage)
        return parse_reaction(reply.text)
