"""How a seat is briefed (VIK-86, ADR-0022): a short guide to playing well, the facts of this turn worked out by the engine, and a personality.

A model that is only told the cards plays timidly and miscounts. So the engine does the arithmetic (`facts.py`) and says what the hand is worth,
what the call costs and what a rule of thumb would do; the personality (`Traits`) decides how closely this seat follows it, how often it bluffs,
how much it talks. The same seat sees the same briefing for the same situation: nothing here is random.
"""

from __future__ import annotations

import random
import zlib
from dataclasses import dataclass, fields

from .governor import budget_for
from .facts import advice, equity_vs_random, hand_name, improving_cards, position, pot_odds, preflop_strength

STRATEGY_PRIMER = """How to play no-limit Hold'em well (a short guide):
- Position matters: acting last is an advantage. Play more hands on the button and fewer from the seats that act first.
- Starting hands: raise the premium and strong hands, play the playable ones when the price is right, fold the weak ones unless the check is free.
- Chance to win against the price: a call breaks even when your chance to win equals the share of the pot you must pay (given as "needs"). Call with more than that, fold with less. Do not chase weak draws with big bets to call.
- When nobody has bet, betting beats checking with a good hand (they fold or pay). Bet about half to three quarters of the pot for value, bigger when a draw is out there. Check weak hands to see a free card; never fold when you can check.
- A raise or a big bet means strength. The "chance to win" you are given assumes opponents hold random cards, so lower it by 10 to 25 points when someone has bet big or raised, more on the turn and river.
- Bluffs work best against one or two opponents, when the board is one your story fits, and not against someone who never folds. Do not bluff into several callers.
- With a short stack (under about 15 big blinds) shove all in with a decent hand or fold. Small raises that commit you are the worst of both.
- Chips are for winning, not for keeping: folding every hand loses to the blinds. But a hand you cannot beat is not worth a big bet."""


def _level(x: float, low: str, mid: str, high: str) -> str:
    return low if x < 0.34 else high if x > 0.66 else mid

@dataclass(frozen=True)
class Traits:
    """How a seat plays, each from 0 to 1 (0.5 is a middling player). They are guidance in words, not dice: a model reads them and plays accordingly."""

    talkative: float = 0.5  # how often and how much it says at the table
    loose: float = 0.5  # how many hands it plays: 0 plays only the best, 1 plays nearly anything
    aggressive: float = 0.5  # raises and bets rather than checks and calls
    bluff: float = 0.5  # how often it bets with nothing
    tricky: float = 0.5  # slow-plays, traps and varies its bets, against playing straight
    emotional: float = 0.5  # how much wins, losses and others' remarks move it (and show in what it says)
    quirk: str = ""  # something in character it does or says now and then

    def __post_init__(self) -> None:
        for f in fields(self):
            v = getattr(self, f.name)
            if f.name != "quirk" and (isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1):
                raise ValueError(f"trait {f.name} must be a number from 0 to 1, got {v!r}")

    @classmethod
    def from_dict(cls, data: dict) -> "Traits":
        known = {f.name for f in fields(cls)}
        unknown = sorted(set(data) - known)
        if unknown:
            raise ValueError(f"unknown trait {unknown[0]!r} (known: {', '.join(sorted(known))})")
        return cls(**{k: (str(v) if k == "quirk" else v) for k, v in data.items()})


def personality_text(name: str, traits: Traits, style: str = "") -> str:
    """The personality section of a seat's instructions. It is only about talk: everyone plays the same sound game (VIK-112), so how loose, aggressive,
    bluffy or tricky a character is shows in how it talks and thinks about the game, never in what it does."""
    t = traits
    lines = [f"Your personality (you are {name}" + (f", {style}" if style else "") + "):"]
    lines.append("- Everyone at this table plays sound poker: your moves come from the numbers and the recommendation you are given, not from your personality. Your personality shows in how you talk and think about the game.")
    lines.append(
        "- How you talk about the game: "
        + _level(
            t.loose,
            "like a patient, careful player who is happy to wait for a good spot.",
            "like an easy-going player who enjoys a hand.",
            "like someone who loves the action and the big pots.",
        )
        + " "
        + _level(
            t.aggressive,
            "You are mild and polite about your bets.",
            "You are friendly about your bets.",
            "You talk big, tease people and like to put pressure on them with words.",
        )
        + _level(
            t.tricky,
            "",
            " Now and then you hint at a trap.",
            " You like to sound mysterious and hint at traps (in words only: your play stays sound).",
        )
    )
    lines.append(
        "- Talking: "
        + _level(
            t.talkative,
            f'you are quiet: about 2 turns in 10 you say something, at most {budget_for(t.talkative).max_words} words, and otherwise your "say" is empty.',
            f'you chat now and then: about every other turn, one short sentence of at most {budget_for(t.talkative).max_words} words.',
            f'you are a chatterbox: most turns, one or two short sentences of at most {budget_for(t.talkative).max_words} words in all. Banter, a jibe at someone, a prediction.',
        )
        + " Talk is for gaining information (fishing for a tell, asking what someone has) or for banter, never to narrate your own move. At most one line per street; a longer or extra line is simply not heard."
    )
    lines.append(
        "- Feelings: "
        + _level(
            t.emotional,
            "you stay calm; your emotion is usually neutral.",
            "you show how you feel when something big happens.",
            "you wear your heart on your sleeve: a win, a bad beat, a bluff caught, they all show in what you say and the emotion you pick.",
        )
    )
    if t.quirk:
        lines.append(f"- Quirk: {t.quirk}")
    lines.append("Speak in your own voice, never echo another player's catchphrase, and do not repeat a phrase you or anyone said recently: find new words each time. Never reveal your cards by accident, and keep each line short enough to say aloud.")
    return "\n".join(lines)


def history_text(events: list[dict], names: dict[str, str]) -> str:
    """What has happened in this hand, street by street, in words ("preflop: ben raised to 6, cy folded")."""
    who = lambda seat: names.get(seat, seat)  # noqa: E731
    streets: dict[str, list[str]] = {}
    blinds: list[str] = []
    for e in events:
        kind = e["type"]
        if kind == "blind":
            blinds.append(f"{who(e['seat_id'])} {e['amount']}")
            continue
        if kind == "win":
            continue
        if kind == "fold":
            said = "folded"
        elif kind == "check":
            said = "checked"
        elif kind == "call":
            said = f"called {e['amount']}"
        elif kind == "raise":
            said = ("went all in, raising to " if e.get("all_in") else "raised to ") + str(e["amount"])
        else:
            continue
        streets.setdefault(e["street"], []).append(f"{who(e['seat_id'])} {said}")
    parts = [f"Blinds: {', '.join(blinds)}."] if blinds else []
    parts += [f"{street.capitalize()}: {', '.join(acts)}." for street, acts in streets.items()]
    return " ".join(parts) if parts else ""


def _rng_for(view: dict) -> random.Random:
    """The same hand on the same board is always given the same numbers: seeded by what the seat can see."""
    return random.Random(zlib.crc32((" ".join(view["hole"]) + "|" + " ".join(view["board"]) + f"|{len(view['players'])}").encode()))


def _dice_for(view: dict) -> random.Random:
    """The dice for the little mixing of the advice: seeded by what the seat can see and how the betting stands, so a spot gives one answer but different hands differ."""
    return random.Random(zlib.crc32((" ".join(view["hole"]) + "|" + " ".join(view["board"]) + f"|{view['pot']}|{view['current_bet']}|dice").encode()))


def turn_facts(view: dict, *, samples: int = 1500) -> dict:
    """The numbers of this turn, from what the seat may know (`Hand.view` for the seat to act). Nothing about anyone else's cards."""
    me_id = view["to_act"]
    legal = view["legal"]
    players = view["players"]
    me = next(p for p in players if p["seat_id"] == me_id)
    opponents = [p for p in players if p["seat_id"] != me_id and not p["folded"]]
    win = equity_vs_random(view["hole"], view["board"], max(1, len(opponents)), rng=_rng_for(view), samples=samples)
    call = legal["call_amount"] if "call" in legal["kinds"] else 0
    dice = _dice_for(view)
    action, why = advice(win=win, call_amount=call, pot=view["pot"], can_check="check" in legal["kinds"], can_raise="raise" in legal["kinds"], opponents=len(opponents), rng=dice)
    raise_to = None
    if action == "raise" and "raise" in legal["kinds"]:
        raise_to = max(legal["min_raise_to"], min(legal["max_raise_to"], int(view["current_bet"] + max(1, dice.uniform(0.5, 0.8) * view["pot"]))))
    facts = {
        "hand": hand_name(view["hole"], view["board"]),
        "win": win,
        "need": pot_odds(call, view["pot"]),
        "call": call,
        "opponents": [p["seat_id"] for p in opponents],
        "position": position([p["seat_id"] for p in players], view["button"], me_id),
        "improving": improving_cards(view["hole"], view["board"]),
        "spr": round(me["stack"] / view["pot"], 1) if view["pot"] else None,
        "advice": action,
        "why": why,
        "raise_to": raise_to,
    }
    if not view["board"]:
        tier, word = preflop_strength(view["hole"])
        facts["tier"] = (tier, word)
    return facts


def briefing(view: dict, facts: dict, history: str, talk: list[tuple[str, str]], names: dict[str, str], recent: int = 8) -> str:
    """The user message of a turn: the situation, the numbers, the story of the hand, the table talk and the legal moves."""
    legal = view["legal"]
    who = lambda seat: names.get(seat, seat)  # noqa: E731
    me = next(p for p in view["players"] if p["seat_id"] == view["to_act"])
    lines = [
        f"Street: {view['street']}. Board: {' '.join(view['board']) or 'none yet'}. Your cards: {' '.join(view['hole'])} ({facts['hand']}"
        + (f"; a {facts['tier'][1]} starting hand" if "tier" in facts else "")
        + ").",
        f"Your position: {facts['position']}. Dealer button: {who(view['button'])}. Opponents still in: {', '.join(who(s) for s in facts['opponents']) or 'none'}.",
        f"Pot: {view['pot']}. Bet to match: {view['current_bet']}. You have {me['stack']} behind and {me['bet']} in this street."
        + (f" Stack-to-pot ratio: {facts['spr']}." if facts["spr"] is not None else ""),
        "Stacks: " + "; ".join(f"{who(p['seat_id'])} {p['stack']}" + (f" (bet {p['bet']})" if p["bet"] else "") + (", folded" if p["folded"] else "") + (", all in" if p["all_in"] else "") for p in view["players"]) + ".",
    ]
    if history:
        lines.append("This hand so far: " + history)
    price = f"calling costs {facts['call']}, so you need to win {facts['need']:.0%} to break even" if facts["call"] else "nothing is owed to stay in"
    lines.append(f"The numbers: you win about {facts['win']:.0%} of the time against random hands ({price})." + (f" {facts['improving']} unseen cards would improve your hand." if facts["improving"] else ""))
    size = f" (a raise to about {facts['raise_to']} is the usual size)" if facts.get("raise_to") else ""
    lines.append(
        f"The recommended move is {facts['advice']}{size}: {facts['why']}. Play the recommended move: it is worked out soundly, the same for everyone at this table, including the odd mixed play that keeps you hard to read. "
        "Break from it only when the story of the hand makes it plainly wrong."
    )
    if talk:
        lines.append("Recent table talk: " + " | ".join(f"{who(s)}: {text}" for s, text in talk[-recent:]))
    options = []
    for kind in legal["kinds"]:
        if kind == "call":
            options.append(f"call (costs {legal['call_amount']})")
        elif kind == "raise":
            options.append(f"raise (to a total between {legal['min_raise_to']} and {legal['max_raise_to']})")
        else:
            options.append(kind)
    lines.append("Your legal actions: " + ", ".join(options) + ".")
    return "\n".join(lines)
