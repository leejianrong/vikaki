"""The decision engine (VIK-118): what to do with these cards in this spot, by arithmetic, with no model and no personality.

Each turn it works out what every opponent may hold from their actions (`opponents.py`), then plays out a few hundred random finishes of the hand with
each opponent given a holding from their range. From those finishes it prices every move it could make, in chips won or lost from now on:

- fold is worth 0;
- call or check wins the pot when the hero's hand is best, and loses the price of the call when it is not;
- a raise or bet of some size also wins the pot when everyone folds, and the more of the range a bet of that size pushes out, the more often that happens.
  An opponent is taken to give up the weaker part of their range, in proportion to the size of the bet (a bet of half the pot is a fold for a third of
  the range, a pot-sized one for half: the share that makes a bluff break even), discounted a little because real opponents fold less than that. The
  rest continue, and the hero's hand is measured against only those.

It tries a few sizes and takes the best, with a little chance mixed in among moves that are nearly as good so that it is not the same every time. Bluffs
and semi-bluffs come out of the arithmetic (a hand that wins little when called but makes many fold) instead of being a rule. It never looks at anyone's
cards but the hero's own. It is not game-theory optimal, and it is not meant to be: it is sound, fast, and the same for every seat.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .cards import full_deck
from .evaluate import best_score
from .opponents import estimate_ranges
from .ranges import Combo, percentiles

# Real opponents give up less often than the range-and-bet-size arithmetic says: fold this fraction of that. 0.8 was behind two rule-of-thumb players; 0.5, 0.3 and 0.0 all beat them by about 260 bb/100 (900 duplicate deals, +-44), and 0.5 keeps some bluffing.
FOLD_DISCOUNT = 0.5
# Moves within this share of the pot of the best are "nearly as good", and may be played instead of it.
NEAR_BEST = 0.04
# How often a nearly-as-good move is played instead of the best one.
MIX = 0.3
PREFLOP_OPEN_SIZES = (2.2, 2.5, 3.0)  # in big blinds
PREFLOP_RAISE_SIZES = (2.5, 3.0, 3.5)  # times the bet to match
POSTFLOP_SIZES = (0.5, 0.75, 1.0)  # of the pot (a smaller bet would only ever be a token one)


@dataclass
class Move:
    kind: str  # fold, check, call or raise
    amount: int | None = None  # the total to raise to, for a raise
    reason: str = ""
    equity: float = 0.0  # the hero's chance to win against everyone who could be holding what they might
    ev: dict[str, float] = field(default_factory=dict)  # chips won or lost from now on, by the move's name


def _candidates(view: dict, hero_stack: int, hero_bet: int, big_blind: int) -> list[int]:
    """The raise totals worth pricing, each legal."""
    legal = view["legal"]
    if "raise" not in legal["kinds"]:
        return []
    low, high = legal["min_raise_to"], legal["max_raise_to"]
    pot, current = view["pot"], view["current_bet"]
    to_call = legal["call_amount"] if "call" in legal["kinds"] else 0
    sizes: list[float] = []
    if not view["board"]:
        if current <= big_blind:
            sizes = [s * big_blind for s in PREFLOP_OPEN_SIZES]
        else:
            sizes = [s * current for s in PREFLOP_RAISE_SIZES]
    elif current == 0:
        sizes = [f * pot for f in POSTFLOP_SIZES]
    else:
        sizes = [current + f * (pot + to_call) for f in (0.5, 0.75, 1.0)]
    out = {max(low, min(high, int(round(s)))) for s in sizes}
    if hero_stack + hero_bet <= 4 * max(pot, 1) or not view["board"] and hero_stack + hero_bet <= 15 * big_blind:
        out.add(high)  # a short stack may shove
    return sorted(out)


def decide(view: dict, events: list[dict], *, big_blind: int, rng: random.Random | None = None, samples: int = 300) -> Move:
    """The move for the seat to act in `view` (`Hand.view` for it), given the hand's `events` so far. Always legal."""
    rng = rng or random.Random()
    hero = view["to_act"]
    legal = view["legal"]
    me = next(p for p in view["players"] if p["seat_id"] == hero)
    kinds = legal["kinds"]
    to_call = legal["call_amount"] if "call" in kinds else 0
    pot = view["pot"]
    board = list(view["board"])
    hole = list(view["hole"])

    ranges = estimate_ranges(view, events, hero, big_blind)
    opps = [s for s in ranges]
    if not opps:  # nobody left to play against
        return Move("check" if "check" in kinds else "call", reason="nobody else is in the hand")
    pct = {s: percentiles(ranges[s], board or None) for s in opps}
    stack_of = {p["seat_id"]: p["stack"] for p in view["players"]}

    deck = [c for c in full_deck() if c not in hole and c not in board]
    need = 5 - len(board)
    trials: list[tuple[tuple, list[tuple], list[float]]] = []  # (hero score, each opponent's score, each opponent's percentile)
    for _ in range(samples):
        used: set[str] = set()
        picks: list[Combo] = []
        ps: list[float] = []
        for s in opps:
            pool = ranges[s]
            combo = None
            for _try in range(8):
                c = rng.choice(pool) if pool else None
                if c is not None and c[0] not in used and c[1] not in used:
                    combo = c
                    break
            if combo is None:
                free = [c for c in deck if c not in used]
                combo = tuple(rng.sample(free, 2))  # type: ignore[assignment]
                ps.append(0.5)
            else:
                ps.append(pct[s].get(combo, 0.5))
            used.update(combo)  # type: ignore[arg-type]
            picks.append(combo)  # type: ignore[arg-type]
        free = [c for c in deck if c not in used]
        run = rng.sample(free, need) if need else []
        full = board + run
        trials.append((best_score(hole + full), [best_score(list(c) + full) for c in picks], ps))

    def share(hero_score, opp_scores) -> float:
        if not opp_scores:
            return 1.0
        top = max(opp_scores)
        if hero_score > top:
            return 1.0
        if hero_score == top:
            return 1 / (1 + sum(1 for t in opp_scores if t == top))
        return 0.0

    equity = sum(share(h, o) for h, o, _ in trials) / len(trials)
    ev: dict[str, float] = {}
    if "fold" in kinds and to_call > 0:
        ev["fold"] = 0.0
    if "call" in kinds:
        ev["call"] = equity * pot - (1 - equity) * to_call
    if "check" in kinds:
        ev["check"] = equity * pot
    sizes = _candidates(view, me["stack"], me["bet"], big_blind)
    for r in sizes:
        s = r - view["current_bet"]  # what the raise adds to the bet to match
        t = r - me["bet"]  # what the hero puts in now
        base = pot + to_call
        f = FOLD_DISCOUNT * s / (base + s) if base + s > 0 else 0.0
        total = 0.0
        for h, o, ps in trials:
            keep = [i for i, p in enumerate(ps) if p < 1 - f or stack_of[opps[i]] == 0]
            if not keep:
                total += pot
                continue
            w = share(h, [o[i] for i in keep])
            total += w * (pot + len(keep) * s) - (1 - w) * t
        ev[f"raise {r}"] = total / len(trials)

    ranked = sorted(ev, key=lambda k: ev[k], reverse=True)
    best = ranked[0]
    near = [k for k in ranked[1:] if ev[k] >= max(0.0, ev[best] - NEAR_BEST * max(pot, big_blind))]  # never a move that loses chips against folding
    pick = rng.choice(near) if near and rng.random() < MIX else best
    return _move(pick, ev, equity, to_call, pot)


def _move(name: str, ev: dict[str, float], equity: float, to_call: int, pot: int) -> Move:
    others = ", ".join(f"{k} {v:+.1f}" for k, v in sorted(ev.items(), key=lambda kv: kv[1], reverse=True) if k != name)
    why = f"about {equity:.0%} to win against what they could hold; worth {ev[name]:+.1f} chips ({others})"
    if name.startswith("raise "):
        return Move("raise", int(name.split()[1]), why, equity, ev)
    return Move(name, None, why, equity, ev)
