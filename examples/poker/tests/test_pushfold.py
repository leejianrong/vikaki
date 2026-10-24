import json
import os

import pytest

from vikaki_poker import pushfold
from vikaki_poker.pushfold import class_weights, depths, equity, lookup, solve_three, solve_two, tables, values_three


def test_the_equity_table_is_a_real_one_symmetric_and_in_strength_order():
    classes, e = equity()
    assert len(classes) == 169 and len(e) == 169 and all(len(r) == 169 for r in e)
    ix = {c: i for i, c in enumerate(classes)}
    assert e[ix["AA"]][ix["KK"]] == pytest.approx(0.82, abs=0.03)  # aces against kings
    assert e[ix["AKs"]][ix["QQ"]] == pytest.approx(0.46, abs=0.03)  # a coin flip, a little behind
    assert e[ix["72o"]][ix["AA"]] < 0.15
    for i in range(0, 169, 7):
        for j in range(0, 169, 11):
            assert e[i][j] + e[j][i] == pytest.approx(1.0, abs=0.002)
    assert sum(class_weights()) == pytest.approx(1.0)


def test_each_hand_class_is_dealt_as_often_as_its_combos():
    classes, _ = equity()
    w = dict(zip(classes, class_weights()))
    assert w["AA"] == pytest.approx(6 / 1326) and w["AKs"] == pytest.approx(4 / 1326) and w["AKo"] == pytest.approx(12 / 1326)


def test_heads_up_the_small_blind_shoves_wide_and_the_big_blind_calls_tighter_and_both_widen_as_stacks_shrink():
    classes, _ = equity()
    def count(v):  # combos, as a share of all
        return sum(p * w for p, w in zip(v, class_weights()))
    ten = solve_two(10.0, 300)
    assert 0.5 < count(ten["sb"]) < 0.8  # the known answer is about three hands in five at ten big blinds
    assert 0.25 < count(ten["bb"]) < 0.55
    assert count(ten["bb"]) < count(ten["sb"])
    assert count(solve_two(5.0, 300)["sb"]) > count(ten["sb"]) > count(solve_two(15.0, 300)["sb"])
    ix = {c: i for i, c in enumerate(classes)}
    assert ten["sb"][ix["AA"]] > 0.99 and ten["bb"][ix["AA"]] > 0.99
    assert ten["sb"][ix["32o"]] < 0.5


def test_with_three_players_the_big_blind_calls_a_shove_and_a_call_tighter_than_a_shove_alone():
    classes, _ = equity()
    r = solve_three(10.0, 300)
    share = lambda v: sum(p * w for p, w in zip(v, class_weights()))  # noqa: E731
    assert share(r["bb_vs_both"]) < share(r["bb_vs_btn"]) < share(r["bb_vs_sb"])  # the more players in front, the tighter
    assert share(r["sb_call"]) < share(r["sb_push"])  # calling a shove is tighter than shoving first
    assert share(r["btn"]) < share(r["sb_push"])  # the button has two players to get past, the small blind one


def test_the_stored_charts_are_an_equilibrium_no_hand_gains_by_switching():
    """Against the stored strategies, the action a class mostly plays is worth at least as much as the other one, to within a few hundredths of a big blind,
    weighted by how often the decision comes up. This ties the file to the code that made it."""
    t = tables()
    for depth in (3.0, 6.0, 10.0, 15.0, 20.0):
        strat = t["three"][str(depth)]
        for name, (evp, evf, reach) in values_three(depth, strat).items():
            for h, p in enumerate(strat[name]):
                gain = (evf[h] - evp[h]) if p > 0.5 else (evp[h] - evf[h])
                assert max(0.0, gain) * reach < 0.02, f"{depth} bb {name} {t['classes'][h]}"


def test_the_file_has_every_depth_and_decision_and_no_probability_outside_0_to_1():
    t = tables()
    assert t["depths"] == depths() and t["depths"][0] == 2.0 and t["depths"][-1] == 20.0
    for depth in t["depths"]:
        assert set(t["three"][str(depth)]) == {"btn", "sb_push", "sb_call", "bb_vs_sb", "bb_vs_btn", "bb_vs_both"}
        assert set(t["two"][str(depth)]) == {"sb", "bb"}
        for table in (t["three"][str(depth)], t["two"][str(depth)]):
            for v in table.values():
                assert len(v) == 169 and all(0 <= x <= 1 for x in v)


def test_lookup_reads_a_class_at_a_depth_blends_between_depths_and_clamps_outside_them():
    assert lookup(3, "btn", "AA", 10.0) > 0.99
    assert lookup(3, "btn", "72o", 10.0) < 0.05
    assert lookup(2, "sb", "T9s", 5.0) > 0.99  # heads up at five blinds nearly everything shoves
    at8, at9, mid = lookup(3, "sb_call", "A5o", 8.0), lookup(3, "sb_call", "A5o", 9.0), lookup(3, "sb_call", "A5o", 8.5)
    assert mid == pytest.approx((at8 + at9) / 2, abs=1e-9)
    assert lookup(3, "btn", "K9o", 0.5) == lookup(3, "btn", "K9o", 2.0)
    assert lookup(3, "btn", "K9o", 99) == lookup(3, "btn", "K9o", 20.0)
    with pytest.raises(ValueError):
        lookup(3, "btn", "ZZ", 10.0)


def test_the_two_data_files_are_the_ones_the_tools_describe():
    for name in ("equity169.json", "pushfold.json"):
        assert os.path.getsize(os.path.join(pushfold.DATA, name)) < 400_000  # small enough to live in the repository
    with open(os.path.join(pushfold.DATA, "pushfold.json")) as f:
        assert json.load(f)["iterations"] >= 300
