from vikaki_poker import Hand
from vikaki_poker.display import table_state


def fresh(**kw):
    return Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4, **kw)


def seat(state, seat_id):
    return next(s for s in state["seats"] if s["seat_id"] == seat_id)


def test_a_new_hand_shows_the_blinds_the_button_and_whose_turn_it_is_with_every_hand_face_down():
    h = fresh()
    s = table_state(h)
    assert s["pot"] == 3 and s["street"] == "preflop" and s["board"] == []
    assert s["dealer"] == "a" and s["turn"] == h.to_act
    assert [(x["seat_id"], x["stack"], x.get("bet")) for x in s["seats"]] == [("a", 100, None), ("b", 99, 1), ("c", 98, 2)]
    assert all(x["cards"] == ["back", "back"] for x in s["seats"])


def test_a_fold_is_shown_and_the_hand_stays_hidden():
    h = fresh()
    first = h.to_act
    h.act(first, "fold")
    s = table_state(h)
    assert seat(s, first)["folded"] is True and "folded" not in seat(s, "b" if first != "b" else "c")
    assert s["turn"] == h.to_act != first
    assert seat(s, first)["cards"] == ["back", "back"]


def test_show_cards_turns_every_live_hand_face_up_but_a_fold_stays_hidden():
    h = fresh()
    first = h.to_act
    h.act(first, "fold")
    s = table_state(h, show_cards=True)
    for x in s["seats"]:
        assert x["cards"] == (["back", "back"] if x["seat_id"] == first else list(h.player(x["seat_id"]).hole))


def call_down(h):
    while not h.complete:
        legal = h.legal()
        h.act(legal.seat_id, "check" if legal.can_check else "call")


def test_the_board_grows_by_street_and_a_showdown_turns_the_hands_that_are_still_in_face_up():
    h = fresh()
    call_down(h)
    s = table_state(h)
    assert h.showdown and s["street"] == "showdown" and len(s["board"]) == 5
    assert "turn" not in s  # nobody is to act
    assert s["pot"] == 0  # the pot has been paid out
    assert sum(x["stack"] for x in s["seats"]) == 300
    for x in s["seats"]:
        assert x["cards"] == list(h.player(x["seat_id"]).hole)


def test_a_hand_won_without_a_showdown_keeps_every_hand_hidden():
    h = fresh()
    while not h.complete:
        h.act(h.to_act, "fold")
    s = table_state(h)
    assert not h.showdown and s["street"] == "complete"
    assert all(x["cards"] == ["back", "back"] for x in s["seats"])
    assert sum(x["stack"] for x in s["seats"]) == 300


def test_the_state_is_a_valid_table_state_message():
    from vikaki_client.messages import make

    h = fresh()
    s = table_state(h)
    make("table_state", **s)
