"""The solvers at the table (VIK-123): where `decide` asks them instead of its own arithmetic.

Two places where a solved answer is better than a rule of thumb, both only when the table is asked to use them (`--solver`):
- **Push/fold** (`pushfold.py`): a short stack (20 big blinds or fewer) at a table of three or two, before anyone has done anything but shove, fold or call a shove.
- **The river** (`river.py`): two players left on the river. The ranges come from what each did (`opponents.py`), the same for both seats, since both saw the same
  betting, and the hand's own cards are put into its seat's range.
Each returns a `Move` like `decide` does, or None when the spot is not one it solves (and `decide` carries on as before).
"""

from __future__ import annotations

import random

from .pushfold import class_weights, depths, equity, lookup, tables, values_three
from .ranges import Combo, all_combos, class_of
from .river import solve_river

PUSHFOLD_MAX_BB = 20.0
# A chance this close to 0 or 1 is taken as 0 or 1: a chart's 0.97 is "always" with the noise of a solve.
SNAP = 0.03
RIVER_MAX_RANGE = 180  # holdings per side the river solver is given; more are sampled down
RIVER_ITERATIONS = 150
# A bet of this share off a size in the solved tree is that size; further off, the solver does not know the spot.
SIZE_TOLERANCE = 0.3


def _snap(p: float) -> float:
    return 1.0 if p >= 1 - SNAP else 0.0 if p <= SNAP else p


def _actions(events: list[dict]) -> list[dict]:
    return [e for e in events if e["street"] == "preflop" and e["type"] in ("fold", "check", "call", "raise")]


def pushfold_move(view: dict, events: list[dict], hero: str, big_blind: int, rng: random.Random):
    """The chart's move, or None when this is not a spot the chart covers. Imported lazily by `decide` so `strategy` stays free of a cycle."""
    from .strategy import Move

    if view["street"] != "preflop" or len(view["hole"]) != 2:
        return None
    players = view["players"]
    n = len(players)
    if n not in (2, 3):
        return None
    names = [p["seat_id"] for p in players]
    b = names.index(view["button"])
    if n == 3:
        order = {"btn": names[b], "sb": names[(b + 1) % 3], "bb": names[(b + 2) % 3]}
    else:
        order = {"sb": names[b], "bb": names[(b + 1) % 2]}
    role = next(r for r, s in order.items() if s == hero)
    acts = _actions(events)
    seats = [e["seat_id"] for e in acts]

    def pushed(e: dict) -> bool:
        return e["type"] == "raise" and bool(e.get("all_in"))

    decision: str | None = None
    if n == 3:
        if role == "btn" and not acts:
            decision = "btn"
        elif role == "sb" and len(acts) == 1 and seats == [order["btn"]]:
            decision = "sb_push" if acts[0]["type"] == "fold" else "sb_call" if pushed(acts[0]) else None
        elif role == "bb":
            if len(acts) == 2 and seats == [order["btn"], order["sb"]] and acts[0]["type"] == "fold" and pushed(acts[1]):
                decision = "bb_vs_sb"
            elif len(acts) == 2 and seats == [order["btn"], order["sb"]] and pushed(acts[0]) and acts[1]["type"] == "fold":
                decision = "bb_vs_btn"
            elif len(acts) == 2 and seats == [order["btn"], order["sb"]] and pushed(acts[0]) and acts[1]["type"] == "call":
                decision = "bb_vs_both"
    else:
        if role == "sb" and not acts:
            decision = "sb"
        elif role == "bb" and len(acts) == 1 and seats == [order["sb"]] and pushed(acts[0]):
            decision = "bb"
    if decision is None:
        return None
    me = next(p for p in players if p["seat_id"] == hero)
    totals = [p["stack"] + p["bet"] for p in players if p["seat_id"] != hero and not p["folded"]]
    if not totals:
        return None
    depth = min(me["stack"] + me["bet"], max(totals)) / big_blind
    if depth > PUSHFOLD_MAX_BB:
        return None
    hand = class_of(*view["hole"])
    p = _snap(lookup(n, decision, hand, depth))
    legal = view["legal"]
    shoving = decision in ("btn", "sb_push", "sb")
    act = rng.random() < p
    if shoving:
        kind = "raise" if act and "raise" in legal["kinds"] else "fold" if "fold" in legal["kinds"] else "check"
        move = Move(kind, legal["max_raise_to"] if kind == "raise" else None)
    else:
        kind = "call" if act and "call" in legal["kinds"] else "fold" if "fold" in legal["kinds"] else "check"
        move = Move(kind)
    classes, e = equity()
    w = class_weights()
    i = classes.index(hand)
    move.equity = sum(wi * ei for wi, ei in zip(w, e[i]))  # against a random hand: how strong the hand is, not a price
    what = "shove" if shoving else "call"
    move.reason = f"the solved push/fold chart at about {depth:.1f} big blinds: {hand} should {what} {p:.0%} of the time ({decision.replace('_', ' ')}); a mix is part of the solution"
    return move


def _combo_in(combo: tuple[str, str], pool: list[Combo]) -> Combo | None:
    s = set(combo)
    for c in pool:
        if set(c) == s:
            return c
    return None


def river_move(view: dict, events: list[dict], hero: str, big_blind: int, rng: random.Random, *, iterations: int = RIVER_ITERATIONS, max_range: int = RIVER_MAX_RANGE):
    """The river solver's move, or None when this is not heads-up on the river or the betting so far is not one the solver's tree can follow."""
    from .opponents import estimate_ranges
    from .strategy import Move

    board = list(view["board"])
    if view["street"] != "river" or len(board) != 5 or len(view["hole"]) != 2 or view["legal"] is None:
        return None
    live = [p for p in view["players"] if not p["folded"]]
    if len(live) != 2:
        return None
    me = next(p for p in live if p["seat_id"] == hero)
    opp = next(p for p in live if p["seat_id"] != hero)
    names = [p["seat_id"] for p in view["players"]]
    b = names.index(view["button"])
    after_button = [names[(b + 1 + i) % len(names)] for i in range(len(names))]
    oop_seat = next(s for s in after_button if s in (me["seat_id"], opp["seat_id"]))
    hero_side = 0 if oop_seat == hero else 1
    pot0 = view["pot"] - me["bet"] - opp["bet"]
    behind = min(me["stack"] + me["bet"], opp["stack"] + opp["bet"])
    if pot0 <= 0 or behind <= 0:
        return None
    # both ranges from the betting both saw (hole cards left out of the dead cards, so each holding of each player is a candidate)
    public = dict(view, hole=[])
    ranges = estimate_ranges(public, events, "", big_blind)
    rng_local = random.Random(rng.random())
    side: list[list[Combo]] = []
    mine = tuple(view["hole"])
    for seat in (oop_seat, opp["seat_id"] if oop_seat == hero else hero):
        pool = list(ranges.get(seat) or all_combos())
        pool = [c for c in pool if not set(c) & set(board)]
        if len(pool) > max_range:
            pool = rng_local.sample(pool, max_range)
        side.append(pool)
    hc = _combo_in(mine, side[hero_side])  # type: ignore[arg-type]
    if hc is None:
        side[hero_side].append(mine)  # type: ignore[arg-type]
        hc = mine  # type: ignore[assignment]
    oop_range = [(c, 1.0) for c in side[0]]
    ip_range = [(c, 1.0) for c in side[1]]
    sizes = (0.5, 1.0)
    sol = solve_river(board, oop_range, ip_range, pot0, behind, sizes=sizes, iterations=iterations)
    # follow the river's betting so far down the tree
    history: list[str] = []
    for e in [e for e in events if e["street"] == "river" and e["type"] in ("check", "call", "raise")]:
        player, actions = sol.actions_at(tuple(history))
        if player < 0:
            return None
        if e["type"] in ("check", "call"):
            if e["type"] not in actions:
                return None
            history.append(e["type"])
            continue
        raise_to = e["amount"]
        if e.get("all_in") or "all-in" in actions and raise_to >= behind:
            name = "all-in"
        else:
            bets = [(a, int(a.split()[1])) for a in actions if a.startswith("bet ")]
            near = min(bets, key=lambda x: abs(x[1] - raise_to), default=None)
            if near is None or abs(near[1] - raise_to) > SIZE_TOLERANCE * near[1]:
                return None
            name = near[0]
        if name not in actions:
            return None
        history.append(name)
    player, actions = sol.actions_at(tuple(history))
    if player != hero_side:
        return None
    probs = sol.strategy(tuple(history), hc)
    names_ = list(probs)
    pick = rng.random()
    chosen = names_[-1]
    acc = 0.0
    for a in names_:
        acc += probs[a]
        if pick <= acc:
            chosen = a
            break
    legal = view["legal"]
    low, high = legal.get("min_raise_to", 0), legal.get("max_raise_to", 0)
    if chosen in ("check", "call", "fold"):
        kind = chosen if chosen in legal["kinds"] else "check" if "check" in legal["kinds"] else "call" if "call" in legal["kinds"] else "fold"
        move = Move(kind)
    else:
        if "raise" not in legal["kinds"]:
            move = Move("call" if "call" in legal["kinds"] else "check")
        else:
            amount = high if chosen == "all-in" else max(low, min(high, int(chosen.split()[1]) + (0 if me["bet"] == 0 else me["bet"])))
            move = Move("raise", amount)
    # how the hand stands against the other side's range, from the solver's own showdown
    sd = sol._showdown  # noqa: SLF001 (the solution's own pricing)
    k = next(i for i, (c, _) in enumerate(sol.ranges[hero_side]) if c == hc)
    win, tie, lose = sd.values(hero_side, [w for _, w in sol.ranges[1 - hero_side]])
    total = win[k] + tie[k] + lose[k]
    move.equity = (win[k] + 0.5 * tie[k]) / total if total else 0.5
    shown = ", ".join(f"{a} {probs[a]:.0%}" for a in names_ if probs[a] >= 0.01)
    move.reason = f"a solved river spot ({'out of' if hero_side == 0 else 'in'} position, pot {pot0}): with this hand the equilibrium plays {shown}; about {move.equity:.0%} to win against what they could hold"
    move.bluffing = move.kind == "raise" and move.equity < 0.35
    return move
