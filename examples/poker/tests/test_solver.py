import json
import random

import pytest

from test_hand import new_hand
from vikaki_poker import Hand, IllegalAction
from vikaki_poker.__main__ import main
from vikaki_poker.llm import FakeLlm
from vikaki_poker.seat import SeatAgent
from vikaki_poker.solver import pushfold_move, river_move
from vikaki_poker.strategy import decide

TABLE = __import__("os").path.join(__import__("os").path.dirname(__file__), "..", "table.example.yaml")


def apply(h: Hand, seat: str, move) -> None:
    h.act(seat, move.kind, move.amount)


def three(stack: int, holes: dict[str, str]) -> Hand:
    return new_hand([stack] * 3, button=0, sb=1, bb=2, holes=holes, board="2c 7d 9h Js Kd")


def test_the_button_shoves_a_strong_hand_and_folds_a_hopeless_one_at_eight_big_blinds():
    h = three(16, {"a": "As Ah"})  # blinds 1 and 2, so 8 big blinds
    move = pushfold_move(h.view("a"), h.events, "a", 2, random.Random(1))
    assert move.kind == "raise" and move.amount == 16 and "push/fold chart" in move.reason
    apply(h, "a", move)  # legal
    h = three(16, {"a": "7c 2d"})
    move = pushfold_move(h.view("a"), h.events, "a", 2, random.Random(1))
    assert move.kind == "fold"


def test_the_small_blind_calls_a_shove_with_a_pair_and_folds_a_weak_hand_and_the_big_blind_sees_both_in_front_of_it():
    h = three(16, {"b": "Kc Kd", "c": "Ts 9s"})
    h.act("a", "raise", 16)
    move = pushfold_move(h.view("b"), h.events, "b", 2, random.Random(1))
    assert move.kind == "call" and "sb call" in move.reason
    apply(h, "b", move)
    big = pushfold_move(h.view("c"), h.events, "c", 2, random.Random(1))  # facing a shove and a call, T9s is too weak
    assert big.kind == "fold" and "bb vs both" in big.reason
    apply(h, "c", big)

    h2 = three(16, {"b": "9c 3d"})
    h2.act("a", "raise", 16)
    assert pushfold_move(h2.view("b"), h2.events, "b", 2, random.Random(1)).kind == "fold"


def test_the_small_blind_shoves_wide_after_the_button_folds_and_the_big_blind_calls_it():
    h = three(16, {"b": "Qs Td", "c": "Ac Qh"})
    h.act("a", "fold")
    move = pushfold_move(h.view("b"), h.events, "b", 2, random.Random(1))
    assert move.kind == "raise" and move.amount == 16  # all of its chips, blind included
    apply(h, "b", move)
    big = pushfold_move(h.view("c"), h.events, "c", 2, random.Random(1))
    assert big.kind == "call" and "bb vs sb" in big.reason


def test_heads_up_the_button_is_the_small_blind_and_the_chart_is_the_two_player_one():
    h = new_hand([12, 12], button=0, sb=1, bb=2, holes={"a": "Jc 5d", "b": "As Ah"})
    move = pushfold_move(h.view("a"), h.events, "a", 2, random.Random(2))
    assert move.kind in ("raise", "fold") and "(sb)" in move.reason
    h.act("a", "raise", 12)
    call = pushfold_move(h.view("b"), h.events, "b", 2, random.Random(2))
    assert call.kind == "call" and "(bb)" in call.reason


def test_a_spot_the_charts_do_not_cover_is_left_to_the_engine():
    deep = three(60, {"a": "As Ah"})  # thirty big blinds: past the charts
    assert pushfold_move(deep.view("a"), deep.events, "a", 2, random.Random(1)) is None
    four = new_hand([16] * 4, button=0, holes={"a": "As Ah"}, board="2c 7d 9h Js Kd")
    assert pushfold_move(four.view("d"), four.events, "d", 2, random.Random(1)) is None
    h = three(16, {"b": "Kc Kd"})
    h.act("a", "raise", 5)  # not a shove: a raise to 2.5 big blinds is not what the chart answers
    assert pushfold_move(h.view("b"), h.events, "b", 2, random.Random(1)) is None
    h = three(16, {"c": "Kc Kd"})
    h.act("a", "fold")
    h.act("b", "call")  # a limp: the big blind may check, which the chart does not cover
    assert pushfold_move(h.view("c"), h.events, "c", 2, random.Random(1)) is None


def test_the_roll_decides_a_mixed_hand_in_the_charts_proportion_and_the_same_roll_plays_the_same():
    from vikaki_poker.pushfold import lookup, tables

    classes = tables()["classes"]
    hand = next(c for c in classes if 0.25 < lookup(3, "btn", c, 8.0) < 0.75 and len(c) == 3 and c.endswith("o"))
    p = lookup(3, "btn", hand, 8.0)
    cards = f"{hand[0]}c {hand[1]}d"
    shoves = 0
    for seed in range(300):
        h = three(16, {"a": cards})
        shoves += pushfold_move(h.view("a"), h.events, "a", 2, random.Random(seed)).kind == "raise"
    assert shoves / 300 == pytest.approx(p, abs=0.1)
    h = three(16, {"a": cards})
    first = pushfold_move(h.view("a"), h.events, "a", 2, random.Random(5))
    second = pushfold_move(h.view("a"), h.events, "a", 2, random.Random(5))
    assert (first.kind, first.amount) == (second.kind, second.amount)


def heads_up_river(stack: int = 200, holes=None) -> Hand:
    """Two players, to the river with the board 2c 7d 9h Js Kd and checks all the way: a (button) acts last, b first."""
    h = new_hand([stack, stack], button=0, sb=1, bb=2, holes=holes or {"a": "Kc Ks", "b": "3c 4d"}, board="2c 7d 9h Js Kd")
    h.act("a", "call")
    h.act("b", "check")
    for _ in range(2):  # the flop and the turn
        h.act("b", "check")
        h.act("a", "check")
    return h


def test_the_river_solver_plays_out_of_position_and_a_hand_that_beats_everything_never_folds_and_bets_some_of_the_time():
    bets = 0
    for seed in range(12):
        h = heads_up_river(holes={"a": "3c 4d", "b": "Kc Ks"})
        assert h.street == "river" and h.to_act == "b"
        move = river_move(h.view("b"), h.events, "b", 2, random.Random(seed), iterations=40, max_range=40)
        assert move is not None and "solved river spot" in move.reason and move.equity > 0.8
        h.act("b", move.kind, move.amount)  # legal
        bets += move.kind == "raise"
    assert 2 <= bets <= 12  # a mix: the nuts also check, to let the other side bluff


def test_the_river_move_is_always_legal_and_follows_a_bet_in_the_tree_or_leaves_the_spot_to_the_engine():
    h = heads_up_river(stack=200, holes={"a": "Ah Qd", "b": "Th 9d"})
    pot = h.pot
    h.act("b", "raise", pot // 2)  # about half the pot, which the tree has
    move = river_move(h.view("a"), h.events, "a", 2, random.Random(3), iterations=40, max_range=40)
    assert move is not None and move.kind in ("fold", "call", "raise")
    h.act("a", move.kind, move.amount)  # legal
    odd = heads_up_river(stack=200, holes={"a": "Ah Qd", "b": "Th 9d"})
    odd.act("b", "raise", 3 * odd.pot)  # three times the pot, short of a shove: not a size the tree has
    assert river_move(odd.view("a"), odd.events, "a", 2, random.Random(3), iterations=40, max_range=40) is None


def test_the_river_solver_is_not_asked_before_the_river_or_with_three_players():
    h = new_hand([100, 100], button=0, holes={"a": "Ah Qd", "b": "Th 9d"}, board="2c 7d 9h Js Kd")
    assert river_move(h.view("a"), h.events, "a", 2, random.Random(1)) is None  # preflop
    t = new_hand([100] * 3, button=0, holes={"a": "Ah Qd"}, board="2c 7d 9h Js Kd")
    t.act("a", "call")
    t.act("b", "call")
    t.act("c", "check")
    for _ in range(2):
        for s in ("b", "c", "a"):
            t.act(s, "check")
    assert t.street == "river" and river_move(t.view("b"), t.events, "b", 2, random.Random(1)) is None


def test_decide_with_the_solver_uses_it_where_it_covers_and_not_otherwise_and_never_without_the_flag():
    h = three(16, {"a": "As Ah"})
    on = decide(h.view("a"), h.events, big_blind=2, rng=random.Random(1), samples=20, solver=True)
    assert "push/fold chart" in on.reason
    off = decide(h.view("a"), h.events, big_blind=2, rng=random.Random(1), samples=20)
    assert "push/fold chart" not in off.reason
    deep = three(100, {"a": "As Ah"})
    assert "push/fold chart" not in decide(deep.view("a"), deep.events, big_blind=2, rng=random.Random(1), samples=20, solver=True).reason


def test_a_seat_with_the_solver_flag_passes_it_to_its_engine_and_the_command_line_has_it(capsys):
    seen = {}

    def engine(view, events, *, big_blind, rng, samples, solver=False):
        seen["solver"] = solver
        from vikaki_poker.strategy import Move

        return Move("fold" if "fold" in view["legal"]["kinds"] else "check")

    agent = SeatAgent("a", "ada", FakeLlm(['{"say": "", "emotion": "neutral"}']), "m", engine=engine, solver=True)
    h = three(16, {"a": "As Ah"})
    agent.decide(h.view("a"), [], h.events)
    assert seen["solver"] is True
    assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "2", "--no-reactions", "--solver", "--stack", "30", "--blinds", "1/2"]) == 0
