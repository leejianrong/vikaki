"""Make `src/vikaki_poker/data/pushfold.json` (VIK-123): the solved push/fold charts for a table of three and for two, at 2 to 20 big blinds.

  uv run python tools/gen_pushfold.py --iterations 600 --jobs 14

Needs `data/equity169.json` (`tools/gen_equity.py`). Each stack depth is solved on its own (see `pushfold.py` for what the solution assumes), which takes
a few seconds each, so the whole file takes a minute or two on a few cores. Probabilities are rounded to two places.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from vikaki_poker.pushfold import DATA, equity, solve_three, solve_two  # noqa: E402

DEPTHS = [2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 17.0, 20.0]


def one(args: tuple[float, int]) -> tuple[float, dict, dict]:
    depth, iterations = args
    r = lambda d: {k: [round(x, 2) for x in v] for k, v in d.items()}  # noqa: E731
    return depth, r(solve_three(depth, iterations)), r(solve_two(depth, iterations))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iterations", type=int, default=600)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 1)
    args = ap.parse_args()
    classes, _ = equity()
    three: dict[str, dict] = {}
    two: dict[str, dict] = {}
    with ProcessPoolExecutor(args.jobs) as pool:
        for depth, a, b in pool.map(one, [(d, args.iterations) for d in DEPTHS]):
            three[str(depth)], two[str(depth)] = a, b
    path = os.path.join(DATA, "pushfold.json")
    with open(path, "w") as f:
        json.dump({"classes": classes, "depths": DEPTHS, "iterations": args.iterations, "three": three, "two": two}, f, separators=(",", ":"))
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()
