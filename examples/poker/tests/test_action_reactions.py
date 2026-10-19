from vikaki_poker.action_reactions import reaction_to, weight_of


def test_how_big_a_move_was():
    assert weight_of("raise", 30, 60, False) == 0.5
    assert weight_of("call", 10, 100, False) == 0.1
    assert weight_of("raise", 500, 20, False) == 1.0  # capped
    assert weight_of("raise", 4, 4, True) == 1.0  # an all-in is the biggest
    assert weight_of("check", None, 50, False) == 0.0 and weight_of("fold", None, 50, False) == 0.0


def test_the_table_is_startled_by_an_all_in_and_a_big_raise_and_unmoved_by_a_small_call():
    allin = reaction_to("raise", 1.0, True, "b", 3)
    assert allin and allin.emotion == "surprised" and allin.gesture in ("shake", "tilt")
    big = reaction_to("raise", 0.8, False, "b", 3)
    assert big and big.emotion in ("worried", "surprised") and big.gesture == "tilt"
    assert reaction_to("call", 0.1, False, "b", 3) is None
    assert reaction_to("check", 0.0, False, "b", 3) is None
    assert reaction_to("fold", 0.0, False, "b", 3) is None


def test_the_same_seat_in_the_same_hand_always_reacts_the_same_way():
    assert reaction_to("raise", 0.9, False, "b", 7) == reaction_to("raise", 0.9, False, "b", 7)
