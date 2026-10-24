"""Make `src/vikaki_poker/data/equity169.json` (VIK-123): the chance that each of the 169 starting-hand classes beats each other one all the way to the river.

  uv run python tools/gen_equity.py --boards 1500 --jobs 14

Each pair of classes is dealt many times (a random holding of each class that shares no card, and a random board), the better hand by `evaluate.best_score` wins,
a tie counts a half. It is Monte Carlo, so each entry is good to about +-0.01 at 1500 boards; the table is symmetric by construction (`eq[j][i] = 1 - eq[i][j]`).
The classes are in `PREFLOP_ORDER` (strongest first). The seed is fixed, so the same command makes the same file.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from vikaki_poker.cards import full_deck  # noqa: E402
from vikaki_poker.evaluate import best_score  # noqa: E402
from vikaki_poker.preflop_ranking import PREFLOP_ORDER  # noqa: E402
from vikaki_poker.ranges import all_combos, class_of  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "vikaki_poker", "data", "equity169.json")


def row(args: tuple[int, int, int]) -> tuple[int, list[float]]:
    """Class `i` against every class `j >= i`: the equity of `i`."""
    i, boards, seed = args
    rng = random.Random(seed * 1000 + i)
    by_class: dict[str, list[tuple[str, str]]] = {}
    for c in all_combos():
        by_class.setdefault(class_of(*c), []).append(c)
    deck = full_deck()
    out: list[float] = []
    for j in range(i, len(PREFLOP_ORDER)):
        a_class, b_class = by_class[PREFLOP_ORDER[i]], by_class[PREFLOP_ORDER[j]]
        total = 0.0
        for _ in range(boards):
            while True:
                a = rng.choice(a_class)
                b = rng.choice(b_class)
                if not set(a) & set(b):
                    break
            free = [c for c in deck if c not in a and c not in b]
            board = rng.sample(free, 5)
            sa, sb = best_score(list(a) + board), best_score(list(b) + board)
            total += 1.0 if sa > sb else 0.5 if sa == sb else 0.0
        out.append(total / boards)
    return i, out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", type=int, default=1500)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    n = len(PREFLOP_ORDER)
    eq = [[0.5] * n for _ in range(n)]
    with ProcessPoolExecutor(args.jobs) as pool:
        for i, vals in pool.map(row, [(i, args.boards, args.seed) for i in range(n)]):
            for k, v in enumerate(vals):
                j = i + k
                eq[i][j] = round(v, 3)
                eq[j][i] = round(1 - v, 3)
    for i in range(n):
        eq[i][i] = 0.5
    with open(OUT, "w") as f:
        json.dump({"classes": PREFLOP_ORDER, "boards": args.boards, "equity": eq}, f, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
