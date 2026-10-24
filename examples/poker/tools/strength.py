"""How strong is a player? Deal many hands between bots and report each seat's net chips per 100 hands (in big blinds), with the standard error.

  uv run python tools/strength.py --hands 1200 --stack 200 --table engine,advisor,advisor
  uv run python tools/strength.py --hands 1200 --stack 100 --table engine,station,random

Every hand is dealt afresh with all stacks reset, and the seats rotate over the table so that position is fair. Hands are shared out to worker processes
(`--jobs`). Poker is noisy: a difference means something only when it is a few standard errors; use more hands for a finer one.
"""

from __future__ import annotations

import argparse
import os
import math
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), "..", "src"))

from vikaki_poker import Hand  # noqa: E402
from vikaki_poker.advisor import AdvisorBot, CallingStation, EngineBot, RandomBot  # noqa: E402


def make(kind: str, seat: str, seed: int, samples: int):
    return {"engine": lambda: EngineBot(seat, seed=seed, samples=samples), "solver": lambda: EngineBot(seat, seed=seed, samples=samples, solver=True), "bluffer": lambda: EngineBot(seat, seed=seed, samples=samples, bluff=float(os.environ.get("BLUFF", "1"))), "advisor": lambda: AdvisorBot(seat, samples=samples), "station": lambda: CallingStation(seat), "random": lambda: RandomBot(seat, seed=seed)}[kind]()


def play(args: tuple[list[str], int, int, int, int, int, dict]) -> list[list[float]]:
    """Deals `lo` to `hi`. Each deal is played once per seat rotation (duplicate poker): the same cards, with each kind of player in each seat in turn, so
    luck of the deal cancels. One row per deal: each entry of `kinds` summed over its rotations, in big blinds."""
    kinds, lo, hi, stack, bb, samples, tune = args
    import vikaki_poker.strategy as strategy

    for k, v in tune.items():
        setattr(strategy, k, v)
    n_seats = len(kinds)
    seats = [f"s{i}" for i in range(n_seats)]
    rows = []
    for n in range(lo, hi):
        row = [0.0] * n_seats
        for r in range(n_seats):
            order = [kinds[(i + r) % n_seats] for i in range(n_seats)]  # the kind in each seat this rotation
            bots = {s: make(k, s, seed=n * 7 + i + r * 1000, samples=samples) for i, (s, k) in enumerate(zip(seats, order))}
            h = Hand([(s, stack) for s in seats], n % n_seats, bb // 2, bb, seed=1000 + n)
            while not h.complete:
                leg = h.legal()
                d = bots[leg.seat_id].decide(h.view(leg.seat_id), events=h.events)
                h.act(leg.seat_id, d.action, d.amount)
            final = h.final_stacks()
            for i in range(n_seats):
                row[(i + r) % n_seats] += (final[seats[i]] - stack) / bb
        rows.append(row)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", type=int, default=600)
    ap.add_argument("--stack", type=int, default=200, help="chips each seat starts every hand with (the blinds are 1/2)")
    ap.add_argument("--table", default="engine,advisor,advisor")
    ap.add_argument("--samples", type=int, default=150)
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--set", action="append", default=[], help="a strategy constant to change for this run, such as FOLD_DISCOUNT=0.5")
    a = ap.parse_args()
    kinds = a.table.split(",")
    step = max(1, a.hands // (a.jobs * 4))
    tune = {k: float(v) for k, v in (x.split("=") for x in a.set)}
    chunks = [(kinds, lo, min(a.hands, lo + step), a.stack, 2, a.samples, tune) for lo in range(0, a.hands, step)]
    with ProcessPoolExecutor(a.jobs) as pool:
        rows = [r for part in pool.map(play, chunks) for r in part]
    print(f"{a.hands} deals (each played in every seat rotation), stacks {a.stack // 2} big blinds, table {a.table}{", " + ", ".join(a.set) if a.set else ""}")
    for i, k in enumerate(kinds):
        xs = [r[i] for r in rows]
        mean = sum(xs) / len(xs)
        sd = math.sqrt(sum((x - mean) ** 2 for x in xs) / (len(xs) - 1))
        print(f"  {k:8s} #{i} {mean * 100 / len(kinds):+8.1f} bb/100 hands  (± {sd / math.sqrt(len(xs)) * 100 / len(kinds):.1f})")


if __name__ == "__main__":
    main()
