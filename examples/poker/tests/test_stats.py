from vikaki_poker import Hand
from vikaki_poker.runner import HandResult
from vikaki_poker.stats import style_lines, style_stats


def played(*moves, said=()):
    h = Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4)
    for seat, kind, *amount in moves:
        h.act(seat, kind, *amount)
    r = HandResult(h)
    r.said.extend(said)
    return r


def test_vpip_pfr_folds_and_aggression_are_counted_per_seat():
    h1 = played(("a", "raise", 6), ("b", "fold"), ("c", "call"))  # a raised, c called, b folded
    h2 = played(("a", "fold"), ("b", "call"), ("c", "check"))  # b called, a folded
    s = {x.seat_id: x for x in style_stats([h1, h2], ["a", "b", "c"])}
    assert s["a"].hands == 2 and s["a"].vpip == 0.5 and s["a"].pfr == 0.5 and s["a"].folds == 0.5
    assert s["b"].vpip == 0.5 and s["b"].pfr == 0 and s["b"].folds == 0.5
    assert s["c"].vpip == 0.5 and s["a"].agg is None  # a never called: nothing to divide by
    assert s["c"].agg == 0.0  # c called and never raised


def test_talk_is_lines_per_move_and_words_per_line():
    r = played(("a", "raise", 6), ("b", "fold"), ("c", "fold"), said=[("a", "Here we go again, friends."), ("b", "Nope.")])
    s = {x.seat_id: x for x in style_stats([r], ["a", "b", "c"])}
    assert s["a"].lines_per_move == 1.0 and s["a"].words_per_line == 5
    assert s["c"].lines_per_move == 0 and s["c"].words_per_line == 0


def test_the_summary_is_a_small_table_by_character():
    r = played(("a", "raise", 6), ("b", "fold"), ("c", "call"))
    rows = style_lines(style_stats([r], ["a", "b", "c"]), {"a": "ada", "b": "ben", "c": "cy"})
    assert rows[0].lstrip().startswith("style:") and any(line.lstrip().startswith("ada") for line in rows)
    assert len(rows) == 4
