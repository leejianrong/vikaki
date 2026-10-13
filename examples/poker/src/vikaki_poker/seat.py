"""One LLM at a seat: what it is told, how its answer is read, and what happens when the answer is no good (ADR-0018).

The seat is shown only what it may know (`Hand.view`) and the recent table talk. It answers with one JSON object. Whatever it says, the engine
decides what is legal: an answer that cannot be used becomes a safe move (check if that is free, else fold) and is noted in `Decision.note`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from .llm import Llm, LlmError, Message, Usage

EMOTIONS = ("neutral", "happy", "smug", "worried", "surprised", "sad", "angry")
MAX_SAY = 240

SYSTEM = """You are {persona}, a friendly cartoon character playing no-limit Texas Hold'em at a small table with other cartoon characters.
Character: {style}
Play to win, but keep the table light and kind. Speak in short natural sentences, as if aloud, and react to what others said.
Reply with ONLY one JSON object, nothing else:
{{"action": "fold" | "check" | "call" | "raise", "amount": <total to raise to, only for raise>, "say": "<one short sentence of table talk, or empty>", "emotion": "<one of: {emotions}>"}}
Never reveal your cards in "say" unless you want to bluff about them. Use only the legal actions you are given."""


@dataclass
class Decision:
    action: str  # fold, check, call or raise
    amount: int | None = None
    say: str = ""
    emotion: str | None = None
    note: str = ""  # empty when the answer was used as given; otherwise what was fixed or why a fallback was taken


def build_messages(persona: str, style: str, view: dict, talk: list[tuple[str, str]], recent: int = 8) -> list[Message]:
    legal = view["legal"]
    me = next(p for p in view["players"] if p["seat_id"] == view["to_act"])
    lines = [
        f"Street: {view['street']}. Board: {' '.join(view['board']) or 'none yet'}. Your cards: {' '.join(view['hole'])}.",
        f"Pot: {view['pot']}. Current bet to match: {view['current_bet']}. You have {me['stack']} behind and {me['bet']} bet this street. Dealer button: {view['button']}.",
        "Players: " + "; ".join(f"{p['seat_id']} stack {p['stack']}, bet {p['bet']}" + (", folded" if p["folded"] else "") + (", all in" if p["all_in"] else "") for p in view["players"]) + ".",
    ]
    if talk:
        lines.append("Recent table talk: " + " | ".join(f"{who}: {text}" for who, text in talk[-recent:]))
    options = []
    for kind in legal["kinds"]:
        if kind == "call":
            options.append(f"call (costs {legal['call_amount']})")
        elif kind == "raise":
            options.append(f"raise (to a total between {legal['min_raise_to']} and {legal['max_raise_to']})")
        else:
            options.append(kind)
    lines.append("Your legal actions: " + ", ".join(options) + ".")
    return [{"role": "system", "content": SYSTEM.format(persona=persona, style=style or "friendly", emotions=", ".join(EMOTIONS))}, {"role": "user", "content": "\n".join(lines)}]


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
    usage: Usage = field(default_factory=Usage)

    def decide(self, view: dict, talk: list[tuple[str, str]] | None = None) -> Decision:
        messages = build_messages(self.persona, self.style, view, talk or [])
        try:
            reply = self.llm.complete(messages, model=self.model, max_tokens=self.max_tokens)
        except LlmError as err:
            return _safe(view["legal"], "", None, f"the model failed: {err}")
        self.usage.add(reply.usage)
        return parse_decision(reply.text, view["legal"])
