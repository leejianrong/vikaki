import pytest

from vikaki_poker.river import _Showdown, build_tree, solve_river

BOARD = ["2c", "7d", "9h", "Js", "Kd"]
NUTS = ("Kc", "Ks")  # three kings
CATCHER = ("Kh", "Qd")  # a pair of kings
AIR = [("3c", "4d"), ("3d", "4c"), ("3h", "4s"), ("3s", "4h"), ("5c", "6d"), ("5d", "6c"), ("5h", "6s"), ("5s", "6h")]


def test_the_tree_has_check_bet_fold_call_and_an_all_in_and_no_more():
    root = build_tree(100, 200, (0.5, 1.0))
    assert root.player == 0 and root.actions == ["check", "bet 50", "bet 100"]
    facing = root.children[2]
    assert facing.player == 1 and facing.actions == ["fold", "call", "all-in"]
    assert facing.children[0].ends == "fold" and facing.children[0].folder == 1
    assert facing.children[1].ends == "showdown" and facing.children[1].put == (100, 100)
    shove = facing.children[2]
    assert shove.player == 0 and shove.actions == ["fold", "call"]  # no raise over an all-in
    checked = root.children[0]
    assert checked.player == 1 and checked.actions[:2] == ["check", "bet 50"]
    assert checked.children[0].ends == "showdown" and checked.children[0].put == (0, 0)


def test_a_bet_that_reaches_the_stack_is_an_all_in_and_a_short_stack_has_no_raise():
    root = build_tree(100, 60, (0.5, 1.0))
    assert root.actions == ["check", "bet 50", "all-in"]  # a pot-size bet is more than 60, so it is the shove
    facing = root.children[2]
    assert facing.actions == ["fold", "call"]
    no_after = build_tree(100, 200, (1.0,), bets_after_check=False)
    assert no_after.children[0].actions == ["check"]


def test_a_showdown_is_priced_with_card_removal_and_ties_and_each_side_of_the_range():
    oop = [(NUTS, 1.0), (("3c", "4d"), 1.0), (CATCHER, 1.0)]
    ip = [(CATCHER, 1.0), (("3d", "4c"), 1.0)]
    sd = _Showdown(BOARD, (oop, ip))
    win, tie, lose = sd.values(0, [1.0, 1.0])
    assert (win[0], tie[0], lose[0]) == (2.0, 0.0, 0.0)  # three kings beats both
    assert (win[1], tie[1], lose[1]) == (0.0, 1.0, 1.0)  # air ties the other side's air (same ranks, other suits) and loses to the pair of kings
    # CATCHER on both sides is one holding: it cannot be dealt to both, so OOP's catcher faces only IP's air, which it beats
    assert (win[2], tie[2], lose[2]) == (1.0, 0.0, 0.0)
    assert sd.blocked_total(0, [1.0, 1.0]) == [2.0, 2.0, 1.0]


def test_the_textbook_bluff_and_call_frequencies_of_a_polar_range_against_a_bluff_catcher():
    """OOP has one nut hand and eight air hands, IP one bluff catcher; a pot-size bet, no betting after a check. In equilibrium OOP bluffs half as often as it
    has nuts (so IP is indifferent: bet / (pot + 2 bet) = 1/3 of the betting range is bluffs) and IP calls half the time (pot / (pot + bet): the bluffs break even)."""
    oop = [(NUTS, 1.0)] + [(c, 1.0) for c in AIR]
    sol = solve_river(BOARD, oop, [(CATCHER, 1.0)], pot=100, stack=100, sizes=(1.0,), iterations=1500, bets_after_check=False, allow_raise=False)
    bet = "all-in"  # a pot-size bet is the whole stack of 100
    assert sol.strategy((), NUTS)[bet] > 0.98  # always bets the nuts
    bluffs = sum(sol.strategy((), c)[bet] for c in AIR)
    assert bluffs == pytest.approx(0.5, abs=0.12)  # half a nut hand's worth of bluffs
    assert sol.strategy((bet,), CATCHER, player=1)["call"] == pytest.approx(0.5, abs=0.08)
    assert sol.exploitability() < 0.02 * 100  # within two chips a hundred of the pot


def test_exploitability_falls_as_it_solves_and_is_small_for_the_full_tree():
    oop = [(NUTS, 1.0)] + [(c, 1.0) for c in AIR[:4]]
    ip = [(CATCHER, 1.0), (("Qc", "Qh"), 1.0), (("8c", "8d"), 1.0)]
    few = solve_river(BOARD, oop, ip, pot=100, stack=150, iterations=15)
    many = solve_river(BOARD, oop, ip, pot=100, stack=150, iterations=400)
    assert many.exploitability() < few.exploitability()
    assert many.exploitability() < 3.0  # a few chips in a hundred


def test_it_drops_holdings_on_the_board_and_refuses_an_empty_range():
    sol = solve_river(BOARD, [(NUTS, 1.0), (("Kd", "As"), 1.0)], [(CATCHER, 1.0)], pot=100, stack=100, iterations=5)
    assert len(sol.ranges[0]) == 1  # Kd is on the board
    with pytest.raises(ValueError):
        solve_river(BOARD, [(("Kd", "As"), 1.0)], [(CATCHER, 1.0)], pot=100, stack=100)


def test_every_strategy_is_a_distribution_and_the_nuts_value_bet_against_a_catcher():
    sol = solve_river(BOARD, [(NUTS, 1.0), (AIR[0], 1.0)], [(CATCHER, 1.0)], pot=100, stack=100, iterations=600)
    seen = 0

    def walk(history: tuple[str, ...]) -> None:
        nonlocal seen
        try:
            player, actions = sol.actions_at(history)
        except ValueError:  # not reached: a terminal has no actions
            return
        if player < 0:
            return
        for combo, _ in sol.ranges[player]:
            probs = sol.strategy(history, combo)
            assert sum(probs.values()) == pytest.approx(1.0)
            assert all(p >= 0 for p in probs.values())
            seen += 1
        node = sol.root
        for a in history:
            node = node.children[node.actions.index(a)]
        for a, child in zip(actions, node.children):
            if not child.ends:
                walk(history + (a,))

    walk(())
    assert seen >= 4
    first = sol.strategy((), NUTS)
    assert 1 - first["check"] > 0.9  # the nuts bet (some size): there is a hand to pay it off
