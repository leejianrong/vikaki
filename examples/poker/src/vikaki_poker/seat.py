"""One seat: the engine picks the move and a model performs it (ADR-0026).

Each turn the decision engine (`strategy.py`) chooses what the seat does, from the cards and the betting alone. A model is then told that move and why,
and asked only for what the character says aloud, thinks, and feels. The model is never asked for an action, so nothing it writes (and nothing in
its personality) can change the move; if it fails or answers badly, the seat still makes the engine's move and just says nothing.
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass, field
from typing import Callable

from .brain import Traits, briefing, history_text, performer_facts, personality_text
from .llm import Llm, LlmError, Message, Usage
from .strategy import Move, big_blind_of, decide as engine_decide

EMOTIONS = ("neutral", "happy", "smug", "worried", "surprised", "sad", "angry")
MAX_SAY = 240
MAX_THINK = 400

SYSTEM = """You are {persona}, a cartoon character at a small table playing no-limit Texas Hold'em with other cartoon characters.

The table's engine plays your cards for you: each turn it has already chosen your move, and you are told what it is and why. You bring the character: what you say aloud, what you think, and how you feel.

{personality}

Reply with ONLY one JSON object, nothing else:
{{"think": "<your private thought, in character>", "say": "<table talk, in character, or empty>", "emotion": "<one of: {emotions}>"}}
"think" is what goes through your head as you make your move: one or two short sentences, at most 25 words, in your own voice (what you hold, what you suspect, why you are doing it). Nobody at the table hears it, only the audience, so be honest in it. It is not table talk: what you say aloud is "say"."""


@dataclass
class Decision:
    action: str  # fold, check, call or raise
    amount: int | None = None
    say: str = ""
    emotion: str | None = None
    note: str = ""  # why the engine chose it, and anything that went wrong with the model
    think: str = ""  # the private thought: shown to the audience, never to another player (VIK-93)


@dataclass
class Performance:
    """What the model gave: the words and the feeling, never the move."""

    say: str = ""
    emotion: str | None = None
    think: str = ""
    note: str = ""


def build_messages(persona: str, style: str, view: dict, talk: list[tuple[str, str]], move: Move, recent: int = 8, *, traits: Traits | None = None, history: str = "", names: dict[str, str] | None = None, facts: dict | None = None) -> list[Message]:
    """The two messages a seat's model gets: who it is (the same every turn), and this turn's situation with the move already decided."""
    names = names or {}
    facts = facts if facts is not None else performer_facts(view)
    system = SYSTEM.format(persona=persona, personality=personality_text(persona, traits or Traits(), style or "friendly"), emotions=", ".join(EMOTIONS))
    return [{"role": "system", "content": system}, {"role": "user", "content": briefing(view, facts, history, talk, names, move, recent)}]


def _json_object(text: str) -> dict | None:
    """The first JSON object in the reply, which may be wrapped in a code fence or surrounded by words."""
    for match in re.finditer(r"\{", text):
        try:
            value, _ = json.JSONDecoder().raw_decode(text[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def parse_performance(text: str) -> Performance:
    """Read a reply for what the character says, thinks and feels. Never raises; anything else in it (an "action", say) is ignored."""
    obj = _json_object(text)
    if obj is None:
        return Performance(note="no JSON in the model's reply")
    say = obj.get("say") if isinstance(obj.get("say"), str) else ""
    think = obj.get("think") if isinstance(obj.get("think"), str) else ""
    return Performance(
        say=" ".join(say.split())[:MAX_SAY],
        emotion=obj.get("emotion") if obj.get("emotion") in EMOTIONS else None,
        think=" ".join(think.split())[:MAX_THINK],
    )


@dataclass
class SeatAgent:
    """A seat: the engine decides, `model` performs. The usage of every model call is kept in `usage`."""

    seat_id: str
    persona: str
    llm: Llm
    model: str
    style: str = ""
    max_tokens: int = 300
    traits: Traits = field(default_factory=Traits)
    usage: Usage = field(default_factory=Usage)
    # The engine: any `decide(view, events, big_blind=, rng=, samples=) -> Move`. Tests give a scripted one; the table uses the real one.
    engine: Callable[..., Move] = engine_decide
    samples: int = 300
    seed: int | None = None
    _rng: random.Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def reseed(self, seed: int) -> None:
        """Start the engine's dice from `seed`: a game replayed with the same `--seed` then plays the same moves (the model's words still differ)."""
        self._rng = random.Random(seed)

    def decide(self, view: dict, talk: list[tuple[str, str]] | None = None, events: list[dict] | None = None, names: dict[str, str] | None = None) -> Decision:
        """`events` are the hand's events so far (`Hand.events`), told as the story of the hand; `names` map seat ids to the characters' names."""
        events = events or []
        move = self.engine(view, events, big_blind=big_blind_of(events), rng=self._rng, samples=self.samples)
        messages = build_messages(self.persona, self.style, view, talk or [], move, traits=self.traits, history=history_text(events, names or {}), names=names)
        try:
            reply = self.llm.complete(messages, model=self.model, max_tokens=self.max_tokens)
        except LlmError as err:
            return Decision(move.kind, move.amount, note=f"{move.reason}; the model failed: {err}")
        self.usage.add(reply.usage)
        say = parse_performance(reply.text)
        note = "; ".join(x for x in (move.reason, say.note) if x)
        return Decision(move.kind, move.amount, say.say, say.emotion, note, say.think)
