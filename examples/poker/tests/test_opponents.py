from vikaki_poker import Hand
from vikaki_poker.opponents import estimate_ranges
from vikaki_poker.ranges import TOTAL_COMBOS


def hand3(deck=None, seed=4):
    return Hand([("a", 200), ("b", 200), ("c", 200)], 0, 1, 2, seed=seed)


def ranges(h, hero):
    return estimate_ranges(h.view(hero), h.events, hero, h.big_blind)


def test_before_anyone_acts_every_opponent_could_hold_anything_but_the_cards_the_hero_sees():
    h = hand3()
    hero = h.to_act
    r = ranges(h, hero)
    assert set(r) == {"a", "b", "c"} - {hero}
    mine = set(h.player(hero).hole)
    for combos in r.values():
        assert all(not (set(c) & mine) for c in combos)
        assert len(combos) == 1225  # 1326 less the 101 holdings that use one of the hero's two cards


def test_a_raise_before_the_flop_is_a_strong_range_and_a_raise_over_it_a_stronger_one():
    h = hand3()
    first = h.to_act
    h.act(first, "raise", 6)
    second = h.to_act
    r = ranges(h, second)
    open_range = r[first]
    assert 350 < len(open_range) < 600  # about the best 38%
    assert ("7c", "2d") not in open_range and ("7d", "2c") not in open_range
    h.act(second, "raise", 20)
    third = h.to_act
    r = ranges(h, third)
    assert len(r[second]) < len(open_range) / 2 and len(r[second]) < 220  # the re-raiser: about the best 14%


def test_a_call_is_a_middling_range_and_a_fold_takes_the_seat_out():
    h = hand3()
    a = h.to_act
    h.act(a, "raise", 6)
    b = h.to_act
    h.act(b, "call")
    c = h.to_act
    r = ranges(h, c)
    assert len(r[b]) < len(r[a]) + 400  # not wider than a limp
    assert a in r and b in r
    h.act(c, "fold")
    assert c not in ranges(h, h.to_act)


def test_a_short_all_in_is_a_wide_range_and_a_deep_re_raise_a_narrow_one():
    short = Hand([("a", 20), ("b", 200)], 0, 1, 2, seed=4)  # heads up the button, a, acts first
    short.act("a", "raise", 20)  # all in for 10 big blinds
    shove = ranges(short, "b")["a"]
    deep = hand3()
    first = deep.to_act
    deep.act(first, "raise", 6)
    second = deep.to_act
    deep.act(second, "raise", 20)  # a 3-bet
    three_bet = ranges(deep, deep.to_act)[second]
    assert len(shove) > 400  # at least the width of an open: about a third of all hands
    assert len(three_bet) < len(shove) / 2


def test_a_bet_after_the_flop_keeps_the_stronger_part_and_a_check_changes_nothing():
    h = Hand([("a", 200), ("b", 200)], 0, 1, 2, seed=11, staged=True)
    while h.awaiting != "street":
        h.act(h.to_act, "check" if h.legal().can_check else "call")
    h.advance()  # the flop
    first = h.to_act
    second = "a" if first == "b" else "b"
    wide = ranges(h, second)[first]
    h.act(first, "check")
    assert len(ranges(h, second)[first]) == len(wide)  # a check says little
    h.act(second, "raise", min(h.legal().max_raise_to, 6))
    assert len(ranges(h, first)[second]) < len(ranges(h, second)[first]) * 0.5  # a bet keeps the stronger part of what they had
