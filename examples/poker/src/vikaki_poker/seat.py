"""One LLM at a seat: what it is told, how its answer is read, and what happens when the answer is no good (ADR-0018).

The seat is shown only what it may know (`Hand.view`) and the recent table talk. It answers with one JSON object. Whatever it says, the engine
decides what is legal: an answer that cannot be used becomes a safe move (check if that is free, else fold) and is noted in `Decision.note`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from .brain import STRATEGY_PRIMER, Traits, briefing, history_text, personality_text, turn_facts
from .llm import Llm, LlmError, Message, Usage

EMOTIONS = ("neutral", "happy", "smug", "worried", "surprised", "sad", "angry")
MAX_SAY = 240

SYSTEM = """You are {persona}, a cartoon character playing no-limit Texas Hold'em at a small table with other cartoon characters. You play to win.

{primer}

{personality}

Reply with ONLY one JSON object, nothing else:
{{"action": "fold" | "check" | "call" | "raise", "amount": <total to raise to, only for raise>, "say": "<table talk, in character, or empty>", "emotion": "<one of: {emotions}>"}}
Use only the legal actions you are given."""


@dataclass
class Decision:
    action: str  # fold, check, call or raise
    amount: int | None = None
    say: str = ""
    emotion: str | None = None
    note: str = ""  # empty when the answer was used as given; otherwise what was fixed or why a fallback was taken


def build_messages(persona: str, style: str, view: dict, talk: list[tuple[str, str]], recent: int = 8, *, traits: Traits | None = None, history: str = "", names: dict[str, str] | None = None, facts: dict | None = None) -> list[Message]:
    """The two messages a seat's model gets: who it is and how to play (the same every turn), and this turn's situation, numbers and legal moves."""
    names = names or {}
    facts = facts if facts is not None else turn_facts(view)
    system = SYSTEM.format(persona=persona, primer=STRATEGY_PRIMER, personality=personality_text(persona, traits or Traits(), style or "friendly"), emotions=", ".join(EMOTIONS))
    return [{"role": "system", "content": system}, {"role": "user", "content": briefing(view, facts, history, talk, names, recent)}]


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


def _safe(legal: dict, say: str, emotion: str | None, note: str) -> Decision:
    return Decision("check" if "check" in legal["kinds"] else "fold", None, say, emotion, note)


def parse_decision(text: str, legal: dict) -> Decision:
    """Read a reply against `legal` (the `legal` part of a `Hand.view`). Never raises."""
    obj = _json_object(text)
    if obj is None:
        return _safe(legal, "", None, "no JSON in the reply")
    say = obj.get("say") if isinstance(obj.get("say"), str) else ""
    say = " ".join(say.split())[:MAX_SAY]
    emotion = obj.get("emotion") if obj.get("emotion") in EMOTIONS else None
    action = str(obj.get("action", "")).strip().lower().replace("-", "_").replace(" ", "_")
    action = {"bet": "raise", "all_in": "raise", "allin": "raise"}.get(action, action)
    kinds = legal["kinds"]
    notes: list[str] = []
    if action == "call" and "check" in kinds:  # "call" when nothing is owed means "check"
        action, notes = "check", ["call read as check"]
    if action not in kinds:
        return _safe(legal, say, emotion, f"action {obj.get('action')!r} is not legal here")
    amount = None
    if action == "raise":
        raw = obj.get("amount")
        if str(obj.get("action", "")).lower().replace("-", "_").replace(" ", "_") in ("all_in", "allin"):
            raw = legal["max_raise_to"]
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            amount = legal["min_raise_to"]
            notes.append("raise had no amount: minimum raise")
        else:
            try:
                amount = int(float(raw))
            except ValueError:
                amount = legal["min_raise_to"]
                notes.append("raise amount unreadable: minimum raise")
        clamped = max(legal["min_raise_to"], min(legal["max_raise_to"], amount))
        if clamped != amount:
            notes.append(f"raise amount {amount} moved to {clamped}")
        amount = clamped
    return Decision(action, amount, say, emotion, "; ".join(notes))


@dataclass
class SeatAgent:
    """An LLM playing one seat. `model` plays; the usage of every call is kept in `usage`."""

    seat_id: str
    persona: str
    llm: Llm
    model: str
    style: str = ""
    max_tokens: int = 200
    traits: Traits = field(default_factory=Traits)
    usage: Usage = field(default_factory=Usage)

    def decide(self, view: dict, talk: list[tuple[str, str]] | None = None, events: list[dict] | None = None, names: dict[str, str] | None = None) -> Decision:
        """`events` are the hand's events so far (`Hand.events`), told as the story of the hand; `names` map seat ids to the characters' names."""
        messages = build_messages(self.persona, self.style, view, talk or [], traits=self.traits, history=history_text(events or [], names or {}), names=names)
        try:
            reply = self.llm.complete(messages, model=self.model, max_tokens=self.max_tokens)
        except LlmError as err:
            return _safe(view["legal"], "", None, f"the model failed: {err}")
        self.usage.add(reply.usage)
        return parse_decision(reply.text, view["legal"])
