"""Push/fold charts for short stacks (VIK-123): who shoves and who calls with which of the 169 starting hands, when the stacks are 2 to 20 big blinds.

With so few chips the game is only "all in or fold", and the best way to play it can be worked out. This file solves it for a table of three (button, small
blind, big blind) and for two (small blind on the button, big blind), in chips, by CFR+ over the strategies of each hand class. It is solved once, offline
(`tools/gen_pushfold.py`), into `data/pushfold.json`; at the table `lookup` reads a chance from it.

What it assumes, so the answer is read for what it is:
- Chip value only (no tournament pay-out): a chip is a chip. Stacks are equal, the effective stack of the hand.
- A hand class does not know about card removal (that AA in your hand makes AA less likely in theirs): each player's class is dealt independently, by combos.
- A two-way all-in uses the real chance of one class beating another (`data/equity169.json`, made by `tools/gen_equity.py`). A three-way one is approximated
  from the two-way chances as 1.2 times their product: exact for nothing, but it gets a three-way pot of equal hands near a third and keeps strong hands strong.
- Nobody limps or min-raises: a hand that is not all-in is folded.
CFR+ on three players is not guaranteed to reach a Nash equilibrium (it reaches a coarse correlated one), but in push/fold it comes very close in practice, and
the tests check that no hand class could do noticeably better by switching its action.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache

DATA = os.path.join(os.path.dirname(__file__), "data")
THREE_WAY = 1.2  # a three-way all-in is this times the product of the two-way chances

SB_BLIND = 0.5
BB_BLIND = 1.0


@lru_cache(maxsize=1)
def equity() -> tuple[list[str], list[list[float]]]:
    with open(os.path.join(DATA, "equity169.json")) as f:
        d = json.load(f)
    return d["classes"], d["equity"]


@lru_cache(maxsize=1)
def class_weights() -> list[float]:
    """The chance of being dealt each class, in `equity()` order: 6 combos a pair, 4 suited, 12 offsuit, over 1326."""
    classes, _ = equity()
    return [(6 if len(c) == 2 else 4 if c.endswith("s") else 12) / 1326 for c in classes]


def _eq_vs(e: list[list[float]], w: list[float], v: list[float]) -> tuple[list[float], float]:
    """For every class h: its chance to beat the range `v` (weighted by how often each class is dealt and plays), and the weight of that range."""
    ws = [wi * vi for wi, vi in zip(w, v)]
    mass = sum(ws)
    if mass <= 1e-12:
        return [0.5] * len(w), 0.0
    return [sum(a * b for a, b in zip(ws, row)) / mass for row in e], mass


class _Regrets:
    """CFR+ for one decision of one player with two actions (fold or the all-in action), a regret and a running average per hand class."""

    def __init__(self, n: int) -> None:
        self.push = [0.0] * n  # regret of the all-in action
        self.fold = [0.0] * n
        self.sum_push = [0.0] * n
        self.sum_all = [0.0] * n
        self.p = [0.5] * n

    def update(self, ev_push: list[float], ev_fold: list[float], reach: float, t: int) -> None:
        for h in range(len(self.p)):
            x = reach * (ev_push[h] - ev_fold[h])
            self.push[h] = max(0.0, self.push[h] + x)
            self.fold[h] = max(0.0, self.fold[h] - x)
            z = self.push[h] + self.fold[h]
            self.p[h] = self.push[h] / z if z > 0 else 0.5
            self.sum_push[h] += t * self.p[h]
            self.sum_all[h] += t

    def average(self) -> list[float]:
        return [a / b if b else 0.5 for a, b in zip(self.sum_push, self.sum_all)]


def solve_three(stack: float, iterations: int = 400) -> dict[str, list[float]]:
    """Solve the table of three at an effective stack of `stack` big blinds. Returns the all-in or call chance of each class for six decisions:
    `btn` (button shoves), `sb_push` (small blind shoves after the button folds), `sb_call` (small blind calls the button's shove), `bb_vs_sb` (big blind calls
    the small blind's shove), `bb_vs_btn` (big blind calls the button's shove after the small blind folds) and `bb_vs_both` (big blind calls a shove and a call)."""
    _, e = equity()
    w = class_weights()
    n = len(w)
    S = stack
    k = THREE_WAY
    btn, sbp, sbc, bb1, bb2, bb3 = (_Regrets(n) for _ in range(6))
    for t in range(1, iterations + 1):
        a, b, c, d1, d2, d3 = btn.p, sbp.p, sbc.p, bb1.p, bb2.p, bb3.p
        Ea, mA = _eq_vs(e, w, a)  # equity of each class against the button's shoving range
        Eb, mB = _eq_vs(e, w, b)  # ... against the small blind's shoving range (after a button fold)
        Ec, mC = _eq_vs(e, w, c)  # ... against the small blind's calling range
        Ed1, mD1 = _eq_vs(e, w, d1)
        Ed2, mD2 = _eq_vs(e, w, d2)
        Ed3, mD3 = _eq_vs(e, w, d3)
        # button: shove or fold (fold is 0)
        ev_btn = []
        for h in range(n):
            after_sb_call = (1 - mD3) * (Ec[h] * (2 * S + BB_BLIND) - S) + mD3 * (k * Ec[h] * Ed3[h] * 3 * S - S)
            sb_folds = (1 - mD2) * (SB_BLIND + BB_BLIND) + mD2 * (Ed2[h] * (2 * S + SB_BLIND) - S)
            ev_btn.append((1 - mC) * sb_folds + mC * after_sb_call)
        btn.update(ev_btn, [0.0] * n, 1.0, t)
        # small blind after a button fold: shove or fold (-0.5)
        ev_sb = [(1 - mD1) * BB_BLIND + mD1 * (Ed1[h] * 2 * S - S) for h in range(n)]
        sbp.update(ev_sb, [-SB_BLIND] * n, 1 - mA, t)
        # small blind facing the button's shove: call or fold (-0.5)
        ev_call = [(1 - mD3) * (Ea[h] * (2 * S + BB_BLIND) - S) + mD3 * (k * Ea[h] * Ed3[h] * 3 * S - S) for h in range(n)]
        sbc.update(ev_call, [-SB_BLIND] * n, mA, t)
        # big blind facing the small blind's shove after a button fold: call or fold (-1)
        bb1.update([Eb[h] * 2 * S - S for h in range(n)], [-BB_BLIND] * n, (1 - mA) * mB, t)
        # big blind facing the button's shove, small blind folded
        bb2.update([Ea[h] * (2 * S + SB_BLIND) - S for h in range(n)], [-BB_BLIND] * n, mA * (1 - mC), t)
        # big blind facing the button's shove and the small blind's call
        bb3.update([k * Ea[h] * Ec[h] * 3 * S - S for h in range(n)], [-BB_BLIND] * n, mA * mC, t)
        # (the averages, not the current strategies, are the answer; the current ones drive the next iteration)
    return {"btn": btn.average(), "sb_push": sbp.average(), "sb_call": sbc.average(), "bb_vs_sb": bb1.average(), "bb_vs_btn": bb2.average(), "bb_vs_both": bb3.average()}


def solve_two(stack: float, iterations: int = 400) -> dict[str, list[float]]:
    """Solve heads-up (the button is the small blind and acts first) at an effective stack in big blinds: `sb` shoves, `bb` calls."""
    _, e = equity()
    w = class_weights()
    n = len(w)
    S = stack
    sb, bb = _Regrets(n), _Regrets(n)
    for t in range(1, iterations + 1):
        Eb, mB = _eq_vs(e, w, bb.p)
        Es, mS = _eq_vs(e, w, sb.p)
        sb.update([(1 - mB) * BB_BLIND + mB * (Eb[h] * 2 * S - S) for h in range(n)], [-SB_BLIND] * n, 1.0, t)
        bb.update([Es[h] * 2 * S - S for h in range(n)], [-BB_BLIND] * n, mS, t)
    return {"sb": sb.average(), "bb": bb.average()}


def values_three(stack: float, strat: dict[str, list[float]]) -> dict[str, list[float]]:
    """The expected chips of each class for each decision's two actions, against `strat`: for checking that no class gains by switching. Returns, per decision,
    `[push_or_call_ev..., fold_ev...]` as `{name: (ev of all-in/call, ev of fold)}` lists by class."""
    _, e = equity()
    w = class_weights()
    n = len(w)
    S, k = stack, THREE_WAY
    a, b, c, d1, d2, d3 = (strat[x] for x in ("btn", "sb_push", "sb_call", "bb_vs_sb", "bb_vs_btn", "bb_vs_both"))
    Ea, mA = _eq_vs(e, w, a)
    Eb, mB = _eq_vs(e, w, b)
    Ec, mC = _eq_vs(e, w, c)
    Ed1, mD1 = _eq_vs(e, w, d1)
    Ed2, mD2 = _eq_vs(e, w, d2)
    Ed3, mD3 = _eq_vs(e, w, d3)
    out: dict[str, tuple[list[float], list[float], float]] = {}
    ev_btn = [(1 - mC) * ((1 - mD2) * (SB_BLIND + BB_BLIND) + mD2 * (Ed2[h] * (2 * S + SB_BLIND) - S)) + mC * ((1 - mD3) * (Ec[h] * (2 * S + BB_BLIND) - S) + mD3 * (k * Ec[h] * Ed3[h] * 3 * S - S)) for h in range(n)]
    out["btn"] = (ev_btn, [0.0] * n, 1.0)
    out["sb_push"] = ([(1 - mD1) * BB_BLIND + mD1 * (Ed1[h] * 2 * S - S) for h in range(n)], [-SB_BLIND] * n, 1 - mA)
    out["sb_call"] = ([(1 - mD3) * (Ea[h] * (2 * S + BB_BLIND) - S) + mD3 * (k * Ea[h] * Ed3[h] * 3 * S - S) for h in range(n)], [-SB_BLIND] * n, mA)
    out["bb_vs_sb"] = ([Eb[h] * 2 * S - S for h in range(n)], [-BB_BLIND] * n, (1 - mA) * mB)
    out["bb_vs_btn"] = ([Ea[h] * (2 * S + SB_BLIND) - S for h in range(n)], [-BB_BLIND] * n, mA * (1 - mC))
    out["bb_vs_both"] = ([k * Ea[h] * Ec[h] * 3 * S - S for h in range(n)], [-BB_BLIND] * n, mA * mC)
    return {name: (x, y, r) for name, (x, y, r) in out.items()}  # type: ignore[return-value]


@lru_cache(maxsize=1)
def tables() -> dict:
    with open(os.path.join(DATA, "pushfold.json")) as f:
        return json.load(f)


def depths() -> list[float]:
    return tables()["depths"]


def lookup(players: int, decision: str, hand_class: str, stack_bb: float) -> float:
    """The chance to go all in (or to call) with `hand_class` ("AKs", "72o", "TT") at `stack_bb` big blinds in this `decision`, from the nearest solved depth below and
    above, blended. `players` is 3 or 2; `decision` is one of the names `solve_three` or `solve_two` return."""
    t = tables()
    classes = t["classes"]
    h = classes.index(hand_class)
    ds = t["depths"]
    s = min(max(stack_bb, ds[0]), ds[-1])
    hi = next(i for i, d in enumerate(ds) if d >= s)
    lo = max(0, hi - 1) if ds[hi] > s else hi
    table = t["three" if players == 3 else "two"]
    p_lo, p_hi = table[str(ds[lo])][decision][h], table[str(ds[hi])][decision][h]
    if hi == lo:
        return p_hi
    f = (s - ds[lo]) / (ds[hi] - ds[lo])
    return p_lo + f * (p_hi - p_lo)
