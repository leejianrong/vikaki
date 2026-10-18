import random

import pytest

from vikaki_poker.facts import advice, equity, equity_vs_random, hand_name, improving_cards, position, pot_odds, preflop_strength


def test_hands_are_named_in_words():
    assert hand_name(["As", "Ah"], []) == "pocket aces"
    assert hand_name(["6s", "6h"], []) == "pocket sixes"
    assert hand_name(["As", "Kh"], []) == "ace-king offsuit"
    assert hand_name(["Qs", "Ts"], []) == "queen-ten suited"
    assert hand_name(["As", "Kh"], ["2d", "7c", "9s"]) == "ace high"
    assert hand_name(["Ks", "Kh"], ["2d", "7c", "9s"]) == "pair of kings"
    assert hand_name(["Ks", "Kh"], ["9d", "7c", "9s"]) == "two pair, kings and nines"
    assert hand_name(["7s", "7h"], ["7d", "2c", "9s"]) == "three of a kind, sevens"
    assert hand_name(["9s", "8h"], ["7d", "6c", "5s"]) == "straight, nine high"
    assert hand_name(["As", "2s"], ["9s", "6s", "3s", "Kd", "Kc"]) == "flush, ace high"
    assert hand_name(["7s", "7h"], ["7d", "2c", "2s"]) == "full house, sevens over twos"
    assert hand_name(["7s", "7h"], ["7d", "7c", "2s"]) == "four of a kind, sevens"
    assert hand_name(["9s", "8s"], ["7s", "6s", "5s"]) == "straight flush, nine high"
    assert hand_name(["As", "Ks"], ["Qs", "Js", "Ts"]) == "royal flush"


def test_a_hand_with_a_one_or_two_card_board_is_refused():
    with pytest.raises(ValueError):
        hand_name(["As", "Kh"], ["2d"])
    with pytest.raises(ValueError):
        hand_name(["As"], [])


def test_equity_with_the_board_finished_is_decided():
    e = equity({"a": ["As", "Ah"], "b": ["Kd", "Kc"]}, ["2s", "7d", "9c", "3h", "4d"])
    assert e == {"a": 1.0, "b": 0.0}


def test_a_tie_is_shared():
    e = equity({"a": ["2s", "3h"], "b": ["2d", "3c"]}, ["As", "Kd", "Qc", "Jh", "Tc"])  # the board is a broadway straight that plays
    assert e == {"a": 0.5, "b": 0.5}


def test_equity_on_the_flop_is_exact_and_adds_up_to_one():
    e = equity({"a": ["As", "Ah"], "b": ["Kd", "Kc"], "c": ["7h", "2d"]}, ["Ks", "8d", "3c"])
    assert sum(e.values()) == pytest.approx(1.0)
    assert e["b"] > 0.85  # a set of kings
    assert e["c"] < 0.02
    assert e == equity({"a": ["As", "Ah"], "b": ["Kd", "Kc"], "c": ["7h", "2d"]}, ["Ks", "8d", "3c"])  # nothing random in it


def test_preflop_equity_is_sampled_close_to_the_known_numbers_and_repeatable_by_seed():
    holes = {"a": ["As", "Ah"], "b": ["Kd", "Kc"], "c": ["7h", "2d"]}
    e = equity(holes, [], rng=random.Random(5), samples=2500)
    assert sum(e.values()) == pytest.approx(1.0)
    assert e["a"] == pytest.approx(0.70, abs=0.04)  # AA against KK against 72o
    assert e["b"] == pytest.approx(0.197, abs=0.04)
    assert e == equity(holes, [], rng=random.Random(5), samples=2500)


def test_equity_against_random_hands_ranks_hands_sensibly():
    aa = equity_vs_random(["As", "Ah"], [], 2, rng=random.Random(1))
    seven_deuce = equity_vs_random(["7h", "2d"], [], 2, rng=random.Random(1))
    assert aa == pytest.approx(0.73, abs=0.05)
    assert seven_deuce < 0.25
    assert equity_vs_random(["As", "Ah"], [], 1, rng=random.Random(1)) > aa  # fewer opponents, better odds
    assert equity_vs_random(["As", "Ah"], [], 0) == 1.0
    assert equity_vs_random(["As", "Ah"], ["Ad", "Ac", "2s", "3h", "9d"], 2, rng=random.Random(1)) > 0.95  # four aces


def test_improving_cards_counts_unseen_cards_that_make_a_better_kind_of_hand():
    assert improving_cards(["As", "Kh"], ["Ad", "7c", "2s"]) == 11  # two aces for trips, three each of K, 7 and 2 for two pair
    assert improving_cards(["As", "Kh"], ["Ad", "7c", "2s", "9d", "3h"]) is None  # no card to come
    assert improving_cards(["As", "Kh"], []) is None
    assert improving_cards(["As", "Ah"], ["Ad", "Ac", "2s"]) == 0  # four aces cannot get better


def test_pot_odds_are_the_price_of_a_call_against_the_pot_it_wins():
    assert pot_odds(0, 100) == 0
    assert pot_odds(50, 100) == pytest.approx(1 / 3)
    assert pot_odds(10, 10) == pytest.approx(0.5)


def test_position_follows_the_button():
    seats = ["a", "b", "c"]
    assert [position(seats, "a", s) for s in seats] == ["button", "small blind", "big blind"]
    assert [position(seats, "b", s) for s in seats] == ["big blind", "button", "small blind"]
    assert [position(["a", "b"], "a", s) for s in ["a", "b"]] == ["button / small blind", "big blind"]
    six = list("abcdef")
    assert [position(six, "a", s) for s in six] == ["button", "small blind", "big blind", "early position", "late position", "late position"]


def test_preflop_tiers():
    assert preflop_strength(["As", "Ah"]) == (1, "premium")
    assert preflop_strength(["As", "Ks"])[0] == 1
    assert preflop_strength(["Kd", "Qs"])[0] <= 3
    assert preflop_strength(["8s", "7s"])[0] == 3
    assert preflop_strength(["7h", "2d"]) == (5, "weak")
    assert preflop_strength(["2h", "2d"])[0] == 4


def test_advice_raises_for_value_calls_when_the_price_is_right_and_folds_when_it_is_not():
    assert advice(win=0.8, call_amount=0, pot=10, can_check=True, can_raise=True, opponents=2)[0] == "raise"
    assert advice(win=0.2, call_amount=0, pot=10, can_check=True, can_raise=True, opponents=2)[0] == "check"
    assert advice(win=0.9, call_amount=20, pot=40, can_check=False, can_raise=True, opponents=1)[0] == "raise"
    assert advice(win=0.55, call_amount=10, pot=40, can_check=False, can_raise=True, opponents=2)[0] == "call"  # needs 20%
    assert advice(win=0.2, call_amount=60, pot=60, can_check=False, can_raise=True, opponents=1)[0] == "fold"  # needs 50%
    action, why = advice(win=0.2, call_amount=60, pot=60, can_check=False, can_raise=False, opponents=1)
    assert action == "fold" and "20%" in why and "50%" in why
    assert advice(win=0.9, call_amount=20, pot=40, can_check=False, can_raise=False, opponents=1)[0] == "call"  # cannot raise: calls


def _mix(n=2000, **spot):
    rng = random.Random(7)
    counts: dict[str, int] = {}
    for _ in range(n):
        a = advice(rng=rng, **spot)[0]
        counts[a] = counts.get(a, 0) + 1
    return {k: v / n for k, v in counts.items()}


def test_a_little_dice_keeps_the_play_from_being_the_same_every_time_but_never_in_a_clear_spot():
    free_weak = dict(win=0.2, call_amount=0, pot=10, can_check=True, can_raise=True, opponents=1)
    bluff = _mix(**free_weak).get("raise", 0)
    assert 0.03 <= bluff <= 0.15  # an occasional bluff when it is free and few are in
    free_monster = dict(win=0.92, call_amount=0, pot=10, can_check=True, can_raise=True, opponents=2)
    slow = _mix(**free_monster).get("check", 0)
    assert 0.02 <= slow <= 0.12  # an occasional slow-play
    marginal = dict(win=0.21, call_amount=10, pot=40, can_check=False, can_raise=True, opponents=2)  # needs 20%: a close call
    mixed = _mix(**marginal)
    assert 0.05 <= mixed.get("fold", 0) <= 0.4 and mixed.get("call", 0) > 0.5
    # clear spots never change
    assert _mix(win=0.1, call_amount=60, pot=60, can_check=False, can_raise=True, opponents=1) == {"fold": 1.0}
    assert _mix(win=0.9, call_amount=20, pot=40, can_check=False, can_raise=True, opponents=1) == {"raise": 1.0}
    assert _mix(win=0.5, call_amount=5, pot=100, can_check=False, can_raise=True, opponents=1).get("call", 0) == 1.0
    # many opponents: no bluffing into a crowd
    assert "raise" not in _mix(win=0.2, call_amount=0, pot=10, can_check=True, can_raise=True, opponents=4)


def test_the_dice_say_so_in_the_reason_and_the_same_dice_give_the_same_answer():
    spot = dict(win=0.2, call_amount=0, pot=10, can_check=True, can_raise=True, opponents=1)
    found = next(advice(rng=random.Random(i), **spot) for i in range(500) if advice(rng=random.Random(i), **spot)[0] == "raise")
    assert "mix" in found[1]
    assert advice(rng=random.Random(3), **spot) == advice(rng=random.Random(3), **spot)
