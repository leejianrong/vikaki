import pytest

from vikaki_poker.ranges import TOTAL_COMBOS, all_combos, board_key, class_of, narrow, percentiles, rank_classes, top_share
from vikaki_poker.preflop_ranking import PREFLOP_ORDER


def test_a_holding_has_a_class_whatever_the_order_or_suits():
    assert class_of("As", "Kh") == "AKo" and class_of("Kh", "As") == "AKo"
    assert class_of("As", "Ks") == "AKs"
    assert class_of("7d", "7c") == "77"


def test_there_are_1326_combos_in_169_classes_and_the_order_lists_each_class_once():
    assert len(all_combos()) == TOTAL_COMBOS == 1326
    assert len(PREFLOP_ORDER) == 169 and len(set(PREFLOP_ORDER)) == 169


def test_the_preflop_order_is_what_a_player_would_expect():
    order = {c: i for i, c in enumerate(PREFLOP_ORDER)}
    assert PREFLOP_ORDER[:3] == ["AA", "KK", "QQ"] and PREFLOP_ORDER[-1] == "32o"
    assert order["AKs"] < order["AKo"] < order["AQo"] < order["A9o"] < order["A2o"]
    assert order["AKs"] < order["ATs"] < order["A5s"]
    assert order["T9s"] < order["T9o"] and order["76s"] < order["72o"]
    assert order["22"] < order["J2s"]  # the smallest pair beats a weak suited hand


def test_the_order_still_comes_from_a_fresh_simulation():
    fresh = rank_classes(samples=250, seed=5)
    pos = {c: i for i, c in enumerate(PREFLOP_ORDER)}
    # coarse agreement: the classes a small simulation puts in the top 20 are all within the top 45 of the stored order, and the worst 20 within the last 45
    assert all(pos[c] < 45 for c in fresh[:20]) and all(pos[c] >= 124 for c in fresh[-20:])


def test_top_share_takes_that_share_of_the_combos_strongest_first_and_leaves_out_dead_cards():
    r = top_share(0.05)
    assert 60 <= len(r) <= 80 and ("As", "Ah") in r or ("Ah", "As") in r
    assert all(set(c) != {"7c", "2d"} for c in r)
    dead = top_share(0.1, frozenset({"As", "Ah"}))
    assert all("As" not in c and "Ah" not in c for c in dead)
    assert len(top_share(1.0)) == TOTAL_COMBOS


def test_narrowing_keeps_the_stronger_part_before_and_after_the_flop():
    r = top_share(0.3)
    half = narrow(r, 0.5)
    assert len(half) == pytest.approx(len(r) / 2, abs=1) and set(half) <= set(r)
    board = ["Ks", "8d", "3c"]
    on_board = [("Kh", "Qd"), ("Ah", "Jd"), ("9h", "9d"), ("7h", "2d"), ("Td", "8c")]
    kept = narrow(on_board, 0.4, board)
    assert ("9h", "9d") in kept and ("Kh", "Qd") in kept and ("7h", "2d") not in kept  # the pairs, not the air
    assert narrow([], 0.5) == [] and len(narrow(on_board, 0.0001, board)) == 1


def test_percentiles_put_the_strongest_at_zero_and_equal_hands_together():
    board = ["Ks", "8d", "3c"]
    combos = [("Kh", "Qd"), ("Kd", "Qh"), ("9h", "9d"), ("7h", "2d")]
    p = percentiles(combos, board)
    assert p[("Kh", "Qd")] == p[("Kd", "Qh")] == 0.0  # the same hand twice
    assert p[("9h", "9d")] > 0 and p[("7h", "2d")] > p[("9h", "9d")]
    assert percentiles([], board) == {}
    pre = percentiles([("As", "Ah"), ("7c", "2d")])
    assert pre[("As", "Ah")] == 0.0 and pre[("7c", "2d")] == 0.5


def test_a_strong_draw_ranks_with_a_pair_when_it_has_not_got_one():
    flop = ["Ks", "8s", "3c"]
    assert board_key(("As", "5s"), flop) == board_key(("9h", "9d"), flop) or board_key(("As", "5s"), flop)[0] == 1  # nut flush draw: a middling pair
    assert board_key(("7h", "2d"), flop)[0] == 0  # air stays air
    assert board_key(("9c", "7d"), ["8s", "6h", "2c"])[0] == 1  # open-ended straight draw
    assert board_key(("9c", "4d"), ["8s", "6h", "2c"])[0] == 0
    assert board_key(("As", "5s"), ["Ks", "8s", "3c", "2d", "9h"])[0] == 0  # no draws on the river
