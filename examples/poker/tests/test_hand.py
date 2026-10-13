import random

import pytest

from vikaki_poker import Hand, IllegalAction, full_deck

IDS = "abcdefgh"


def rig(ids: list[str], button: int, holes: dict[str, str], board: str) -> list[str]:
    """A deck that deals the given hole cards and board, in the engine's dealing order (see the `hand` module docstring)."""
    n = len(ids)
    order = [ids[(button + k) % n] for k in range(1, n + 1)]
    hole = {s: holes[s].split() for s in ids if s in holes}
    used = {c for cs in hole.values() for c in cs} | set(board.split())
    spare = [c for c in full_deck() if c not in used]
    for s in order:  # players without chosen cards get spares
        hole.setdefault(s, [spare.pop(), spare.pop()])
    deck = [hole[s][0] for s in order] + [hole[s][1] for s in order]
    flop, turn, river = board.split()[:3], board.split()[3:4], board.split()[4:5]
    for street in (flop, turn, river):
        deck += [spare.pop()] + street  # a burn card, then the street
    return deck


def new_hand(stacks: list[int], button: int = 0, sb: int = 1, bb: int = 2, holes: dict[str, str] | None = None, board: str | None = None, seed: int = 1) -> Hand:
    ids = list(IDS[: len(stacks)])
    deck = rig(ids, button, holes or {}, board) if board else None
    return Hand(list(zip(ids, stacks)), button, sb, bb, seed=seed, deck=deck)


def check_down(h: Hand) -> None:
    while not h.complete:
        legal = h.legal()
        h.act(legal.seat_id, "check" if legal.can_check else "call")


def test_heads_up_the_button_posts_the_small_blind_and_acts_first():
    h = new_hand([100, 100], button=0)
    assert [(p.seat_id, p.bet) for p in h.seats] == [("a", 1), ("b", 2)]
    assert h.to_act == "a"
    legal = h.legal()
    assert (legal.call_amount, legal.can_check, legal.min_raise_to, legal.max_raise_to) == (1, False, 4, 100)
    h.act("a", "call")
    assert h.to_act == "b" and h.legal().can_check  # the big blind has the option
    h.act("b", "check")
    assert h.street == "flop" and len(h.board) == 3
    assert h.to_act == "b"  # after the flop the player who is not the button acts first


def test_three_handed_blinds_and_order():
    h = new_hand([100, 100, 100], button=0)
    assert [(p.seat_id, p.bet) for p in h.seats] == [("a", 0), ("b", 1), ("c", 2)]
    assert h.to_act == "a"  # under the gun
    h.act("a", "call")
    h.act("b", "call")
    h.act("c", "check")
    assert h.street == "flop" and h.to_act == "b"  # first left of the button


def test_everyone_folds_to_the_big_blind_no_showdown():
    h = new_hand([100, 100, 100], button=0)
    h.act("a", "fold")
    h.act("b", "fold")
    assert h.complete and not h.showdown
    assert h.winnings == {"c": 3}
    assert h.final_stacks() == {"a": 100, "b": 99, "c": 101}


def test_showdown_awards_the_pot_to_the_best_hand():
    h = new_hand([100, 100], button=0, holes={"a": "As Ad", "b": "7h 2c"}, board="Ks 9d 4c 3h Jd")
    h.act("a", "raise", 10)
    h.act("b", "call")
    check_down(h)
    assert h.showdown and h.winnings == {"a": 20}
    assert h.final_stacks() == {"a": 110, "b": 90}
    assert [e["type"] for e in h.events if e["type"] in ("showdown", "win")] == ["showdown", "win"]


def test_a_tie_splits_and_the_odd_chip_goes_left_of_the_button():
    # a calls, b (small blind) folds, c checks: pot 5 (b's small blind stays in). a and c tie on the board; c is first left of the button.
    h = new_hand([100, 100, 100], button=0, sb=1, bb=2, holes={"a": "2c 3d", "c": "4c 5d", "b": "7s 8s"}, board="Ah Kh Qh Jh Th")
    h.act("a", "call")
    h.act("b", "fold")
    h.act("c", "check")
    check_down(h)
    assert h.winnings == {"c": 3, "a": 2}
    assert sum(h.final_stacks().values()) == 300


def test_side_pots_and_the_uncalled_part_of_a_bet_goes_back():
    stacks = [50, 100, 200]  # a, b, c; button is c, so a is the small blind, b the big blind and c is first to act
    holes = {"a": "As Ad", "b": "Ks Kd", "c": "2s 3d"}  # a best, b second, c worst
    h = new_hand(stacks, button=2, holes=holes, board="7h 8c Jd 4s 9h")
    h.act("c", "raise", 200)
    h.act("a", "call")
    h.act("b", "call")
    assert h.complete and h.showdown
    assert [(p["amount"], p["eligible"], p["winners"]) for p in h.pots] == [(150, ["a", "b", "c"], ["a"]), (100, ["b", "c"], ["b"]), (100, ["c"], ["c"])]
    assert h.final_stacks() == {"a": 150, "b": 100, "c": 100}


def test_the_best_hand_takes_every_pot_it_is_in():
    holes = {"a": "2s 3d", "b": "Ks Kd", "c": "As Ad"}  # c best
    h = new_hand([50, 100, 200], button=2, holes=holes, board="7h 8c Jd 4s 9h")
    h.act("c", "raise", 200)
    h.act("a", "call")
    h.act("b", "call")
    assert h.final_stacks() == {"a": 0, "b": 0, "c": 350}


def test_the_board_runs_out_when_everyone_is_all_in():
    h = new_hand([30, 30], button=0, holes={"a": "As Ad", "b": "Ks Kd"}, board="2h 5c 7d 9s Jh")
    h.act("a", "raise", 30)
    h.act("b", "call")
    assert h.complete and h.board == ["2h", "5c", "7d", "9s", "Jh"]
    assert h.final_stacks() == {"a": 60, "b": 0}


def test_a_full_raise_sets_the_next_minimum_raise():
    h = new_hand([1000, 1000, 1000], button=0, sb=10, bb=20)
    h.act("a", "raise", 100)  # raised by 80
    legal = h.legal()  # b, the small blind
    assert legal.call_amount == 90 and legal.min_raise_to == 180 and legal.max_raise_to == 1000


def test_a_short_all_in_does_not_let_players_who_already_acted_raise_again():
    h = new_hand([1000, 1000, 130], button=0, sb=10, bb=20)  # c, the big blind, has 130 in all
    h.act("a", "raise", 100)
    h.act("b", "call")
    h.act("c", "raise", 130)  # all in: a raise of only 30, short of the 80 needed
    legal = h.legal()
    assert h.to_act == "a" and not legal.can_raise and legal.call_amount == 30
    with pytest.raises(IllegalAction):
        h.act("a", "raise", 500)
    h.act("a", "call")
    assert h.to_act == "b" and not h.legal().can_raise
    h.act("b", "call")
    assert h.street == "flop"


def test_a_short_all_in_still_lets_a_player_who_has_not_acted_raise():
    h = new_hand([1000, 1000, 1000, 25], button=0, sb=10, bb=20)  # button a, small blind b, big blind c, so d is first to act
    assert h.to_act == "d"
    h.act("d", "raise", 25)  # a raise of 5 over the big blind: short
    assert h.to_act == "a" and h.legal().can_raise  # a has not acted yet


def test_illegal_actions_are_refused_and_change_nothing():
    h = new_hand([100, 100, 100], button=0)
    before = (h.to_act, h.pot, h.final_stacks(), len(h.events))
    for who, kind, amount in [
        ("b", "call", None),  # not b's turn
        ("a", "check", None),  # facing the big blind
        ("a", "raise", 3),  # below the minimum raise (4)
        ("a", "raise", 101),  # more than the stack
        ("a", "raise", None),
        ("a", "raise", 4.5),
        ("a", "dance", None),
    ]:
        with pytest.raises(IllegalAction):
            h.act(who, kind, amount)  # type: ignore[arg-type]
    assert (h.to_act, h.pot, h.final_stacks(), len(h.events)) == before
    h.act("a", "call")
    h.act("b", "call")
    with pytest.raises(IllegalAction):
        h.act("c", "call")  # nothing to call, check instead


def test_acting_after_the_hand_is_over_is_refused():
    h = new_hand([100, 100], button=0)
    h.act("a", "fold")
    with pytest.raises(IllegalAction):
        h.act("b", "check")


def test_a_view_shows_only_your_own_hole_cards():
    h = new_hand([100, 100, 100], button=0, holes={"a": "As Ad", "b": "Ks Kd", "c": "2s 3d"}, board="7h 8c Jd 4s 9h")
    va, vspec = h.view("a"), h.view(None)
    assert va["hole"] == ["As", "Ad"] and vspec["hole"] == []
    assert "Ks" not in str(va) and "2s" not in str(va)
    assert va["legal"]["kinds"] == ["fold", "call", "raise"] and vspec["legal"] is None
    assert h.view("b")["legal"] is None  # not b's turn


def test_same_seed_same_deal_and_different_seed_different():
    a, b, c = new_hand([100, 100, 100], seed=5), new_hand([100, 100, 100], seed=5), new_hand([100, 100, 100], seed=6)
    assert [p.hole for p in a.seats] == [p.hole for p in b.seats] != [p.hole for p in c.seats]


def test_bad_setup_is_an_error():
    with pytest.raises(ValueError):
        Hand([("a", 100)], 0, 1, 2)
    with pytest.raises(ValueError):
        Hand([("a", 100), ("a", 100)], 0, 1, 2)
    with pytest.raises(ValueError):
        Hand([("a", 100), ("b", 0)], 0, 1, 2)
    with pytest.raises(ValueError):
        Hand([("a", 100), ("b", 100)], 2, 1, 2)
    with pytest.raises(ValueError):
        Hand([("a", 100), ("b", 100)], 0, 3, 2)


def play_randomly(seed: int) -> Hand:
    rng = random.Random(seed)
    n = rng.randint(2, 6)
    stacks = [rng.choice([5, 17, 40, 100, 250, 1000]) for _ in range(n)]
    h = new_hand(stacks, button=rng.randrange(n), sb=rng.choice([1, 2, 5]), bb=rng.choice([5, 10]), seed=seed)
    for _ in range(300):
        legal = h.legal()
        if legal is None:
            break
        roll = rng.random()
        if roll < 0.15:
            h.act(legal.seat_id, "fold")
        elif roll < 0.35 and legal.can_raise:
            h.act(legal.seat_id, "raise", rng.randint(legal.min_raise_to, legal.max_raise_to))
        elif legal.can_check:
            h.act(legal.seat_id, "check")
        else:
            h.act(legal.seat_id, "call")
    return h


@pytest.mark.parametrize("seed", range(400))
def test_random_hands_finish_and_conserve_chips(seed: int):
    h = play_randomly(seed)
    assert h.complete
    assert sum(h.final_stacks().values()) == sum(h.start_stacks.values())
    assert all(s >= 0 for s in h.final_stacks().values())
    assert sum(h.winnings.values()) == h.pot == sum(p["amount"] for p in h.pots)
    assert all(h.winnings.get(s, 0) <= h.pot for s in h.winnings)
    assert len(h.board) in (0, 3, 4, 5) and len(set(h.board)) == len(h.board)


def test_random_hands_are_repeatable():
    a, b = play_randomly(123), play_randomly(123)
    assert a.events == b.events and a.final_stacks() == b.final_stacks()
