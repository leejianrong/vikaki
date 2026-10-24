"""A commentator for the table (VIK-110): a voice of its own that calls the action for the people watching, on a budget.

It is not a player. It sees what the audience sees (the board, the stacks, the bets, and the spectator numbers the page already shows: each live hand's name
and chance to win, when they are shown) and never a hidden card. It speaks on the beats of a hand, between the players' lines (the runner is one thing at a time and
the hub speaks one line at a time, so it never talks over a player), with its own persona and voice, as `kind: commentary`, which the page puts in its own strip.

It talks less than the table: at most `budget` lines a hand (one is kept for the result), at least `min_gap` beats apart, and a beat is chosen only when it is a moment:
the first hand's opening and one now and then, each street, an all-in or a big bet, the showdown and the win. A line is one or two short sentences. With a model it
writes them; with none (or when the model fails) a template says the beat plainly, so the table is never left silent by a broken key.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .llm import Llm, LlmError
from .voice import clean

MAX_WORDS = 28
INTRO_EVERY = 5  # an opening line on the first hand and every this many after
BIG_BET_SHARE = 0.5  # a bet or raise of at least this share of the pot is a big one

DESK = "desk"  # the commentator's persona on the hub (its voice); it has no avatar at the table

STYLE = "a warm, quick sports commentator who loves a good bluff and never takes sides; short sentences, a little drama, plain words"


def system_prompt(style: str) -> str:
    return (
        f"You are the commentator of a poker game between cartoon characters, for people watching. Your style: {style}.\n"
        f"Say one or two short sentences, at most {MAX_WORDS} words in all, about the moment you are given. Talk to the audience, not to the players.\n"
        "Use only the facts you are given: the board, the stacks, the bets and the numbers shown. Never guess a hidden card. Do not announce the rules. "
        "No dashes to set things off, no stock phrases, and never mention a program, an engine or a model. Reply with the line only."
    )


def moment_of(event: dict[str, Any], hand_no: int, pot: int) -> str | None:
    """Why this beat is worth a line, or None. `pot` is the pot before it."""
    kind = event.get("kind")
    if kind == "new_hand":
        return "opening" if hand_no == 1 or (hand_no - 1) % INTRO_EVERY == 0 else None
    if kind == "street":
        return "street"
    if kind == "showdown":
        return "showdown"
    if kind == "win":
        return "win"
    if kind in ("raise", "call"):
        amount = event.get("amount") or 0
        if "all in" in str(event.get("text", "")):
            return "all-in"
        if pot > 0 and amount >= BIG_BET_SHARE * pot and amount >= 6:
            return "big bet"
    return None


def facts_of(state: dict[str, Any], event: dict[str, Any], names: dict[str, str], reason: str) -> str:
    """The public facts of the moment as plain lines for the model: nothing here is a hidden card."""
    lines = [f"Moment: {reason}. {event.get('text', '')}".strip()]
    if state.get("hand_no"):
        lines.append(f"Hand {state['hand_no']}, {state.get('street', 'preflop')}.")
    board = state.get("board") or []
    lines.append("Board: " + (" ".join(board) if board else "none yet") + f". Pot: {state.get('pot', 0)}.")
    for s in state.get("seats", []):
        who = names.get(s["seat_id"], s["seat_id"]).capitalize()
        bits = [f"stack {s['stack']}"]
        if s.get("bet"):
            bits.append(f"bet {s['bet']}")
        if s.get("folded"):
            bits.append("folded")
        if s.get("hand"):
            bits.append(f"shows {s['hand']}")
        if s.get("win") is not None:
            bits.append(f"{round(s['win'] * 100)}% to win")
        if s.get("out"):
            bits.append("out of chips")
        lines.append(f"{who}: " + ", ".join(bits))
    for w in state.get("winners") or []:
        who = names.get(w["seat_id"], w["seat_id"]).capitalize()
        lines.append(f"{who} won {w['amount']}" + (f" with {w['hand']}" if w.get("hand") else ""))
    return "\n".join(lines)


def template_line(event: dict[str, Any], state: dict[str, Any], names: dict[str, str], reason: str) -> str:
    """What to say with no model: the beat, plainly."""
    text = str(event.get("text", "")).strip()
    if reason == "opening":
        return f"{text}. Let's see who gets the chips." if text else "Here we go."
    if reason == "street":
        board = " ".join(state.get("board") or [])
        return f"{text}: {board}." if board else f"{text}."
    if reason == "showdown":
        return "Cards up. Let's see who has it."
    if reason == "win":
        w = (state.get("winners") or [None])[0]
        if w:
            who = names.get(w["seat_id"], w["seat_id"]).capitalize()
            return f"{who} takes {w['amount']}" + (f" with {w['hand']}." if w.get("hand") else ".")
        return "And that's the pot."
    return f"{text}. That's a big one." if text else "That's a big one."


@dataclass
class Commentator:
    """Decides when to speak and what to say. `llm` and `model` write the lines; with `llm=None` the template does."""

    llm: Llm | None = None
    model: str = ""
    budget: int = 3  # lines a hand
    min_gap: int = 2  # beats between lines (the win is exempt)
    style: str = STYLE
    max_tokens: int = 80
    spoken: int = field(default=0, init=False)
    _since: int = field(default=0, init=False)
    _hand: int = field(default=-1, init=False)
    lines: list[str] = field(default_factory=list, init=False)  # every line said, for the summary and the tests
    failures: int = field(default=0, init=False)

    def start_hand(self, hand_no: int) -> None:
        self._hand = hand_no
        self.spoken = 0
        self._since = self.min_gap  # the first beat may speak

    def line_for(self, event: dict[str, Any], state: dict[str, Any], pot_before: int, names: dict[str, str]) -> str | None:
        """What to say at this beat of the hand, or None to stay quiet. Counts the beat; a line spends the budget."""
        self._since += 1
        reason = moment_of(event, state.get("hand_no") or self._hand + 1, pot_before)
        if reason is None or self.budget <= 0:
            return None
        final = reason in ("win",)
        if self.spoken >= self.budget:
            return None
        if not final and self.spoken >= self.budget - 1:
            return None  # the last line of the budget is the result's
        if not final and self._since < self.min_gap:
            return None
        text = self._write(event, state, names, reason)
        if not text:
            return None
        self.spoken += 1
        self._since = 0
        self.lines.append(text)
        return text

    def _write(self, event: dict[str, Any], state: dict[str, Any], names: dict[str, str], reason: str) -> str:
        if self.llm is not None:
            try:
                reply = self.llm.complete(
                    [{"role": "system", "content": system_prompt(self.style)}, {"role": "user", "content": facts_of(state, event, names, reason)}],
                    model=self.model,
                    max_tokens=self.max_tokens,
                )
                text = clean(" ".join(reply.text.split()))
                words = text.split()
                if len(words) > MAX_WORDS:
                    cut = " ".join(words[:MAX_WORDS])
                    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
                    text = cut[: end + 1] if end > 20 else cut
                if text:
                    return text
            except LlmError:
                self.failures += 1  # the table is never left silent by a broken model: fall through to the template
        return clean(template_line(event, state, names, reason))
