import pytest

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
    pytest.importorskip("vikaki_client")  # the poker example does not depend on the client; with it, the payload is checked against the schema
    from vikaki_client.messages import make

    h = fresh()
    s = table_state(h)
    make("table_state", **s)


# ---- the spectator's numbers (VIK-83) ----


def test_face_down_hands_come_with_no_words_and_no_odds_because_they_would_give_the_hand_away():
    s = table_state(fresh())
    for x in s["seats"]:
        assert "hand" not in x and "win" not in x


def test_face_up_hands_come_with_their_name_and_their_chance_to_win_which_add_up_to_one():
    h = fresh()
    s = table_state(h, show_cards=True)
    live = [x for x in s["seats"] if "win" in x]
    assert len(live) == 3
    assert sum(x["win"] for x in live) == pytest.approx(1.0, abs=0.001)
    for x in s["seats"]:
        assert x["hand"]  # "pocket kings", "ace-king suited", ...
    assert 0 < min(x["win"] for x in live) < max(x["win"] for x in live) < 1


def test_a_folded_seat_has_neither_and_the_others_share_the_pot():
    h = fresh()
    first = h.to_act
    h.act(first, "fold")
    s = table_state(h, show_cards=True)
    assert "hand" not in seat(s, first) and "win" not in seat(s, first)
    assert sum(x["win"] for x in s["seats"] if "win" in x) == pytest.approx(1.0, abs=0.001)
    assert seat(s, first)["action"] == "folded"


def test_at_the_showdown_the_winner_has_every_chance_and_the_hands_have_names():
    h = fresh()
    call_down(h)
    s = table_state(h)
    wins = sorted(x["win"] for x in s["seats"] if "win" in x)
    assert wins[-1] == 1.0 and wins[0] == 0.0 or sum(wins) == pytest.approx(1.0)
    assert all(" " in x["hand"] or x["hand"].endswith("high") for x in s["seats"])


def test_what_a_seat_did_last_is_said_in_a_spectators_words_and_blinds_are_not_actions():
    h = fresh()
    assert all("action" not in x for x in table_state(h)["seats"])  # only blinds so far
    first = h.to_act
    h.act(first, "call")
    assert seat(table_state(h), first)["action"] == "called 2"
    second = h.to_act
    h.act(second, "raise", 8)
    assert seat(table_state(h), second)["action"] == "raised to 8"


def test_the_same_hands_and_board_are_worked_out_once():
    from vikaki_poker.display import _win_chances

    _win_chances.cache_clear()
    h = fresh()
    table_state(h, show_cards=True)
    table_state(h, show_cards=True)
    assert _win_chances.cache_info().hits >= 1 and _win_chances.cache_info().misses == 1


def test_the_beat_the_hand_number_and_the_winners_are_passed_on_for_the_page():
    h = fresh()
    s = table_state(h, event={"kind": "new_hand", "text": "Hand 3"}, hand_no=3, winners=[{"seat_id": "a", "amount": 6}])
    assert s["event"] == {"kind": "new_hand", "text": "Hand 3"} and s["hand_no"] == 3 and s["winners"] == [{"seat_id": "a", "amount": 6}]
    plain = table_state(h)
    assert "event" not in plain and "hand_no" not in plain and "winners" not in plain


def test_a_staged_showdown_turns_the_hands_over_while_the_pot_is_still_on_the_table():
    h = Hand([("a", 100), ("b", 100)], 0, 1, 2, seed=4, staged=True)
    while h.awaiting != "showdown":
        h.advance() if h.awaiting else h.act(h.to_act, "check" if h.legal().can_check else "call")
    h.advance()  # the hands are turned over; not yet paid
    s = table_state(h)
    assert s["street"] == "showdown" and s["pot"] == 4 and all(x["cards"][0] != "back" for x in s["seats"])
    h.advance()
    s = table_state(h)
    assert s["street"] == "showdown" and s["pot"] == 0  # paid


def test_a_seat_carries_how_much_its_body_moves_when_the_game_says_so_and_nothing_when_it_does_not():
    h = fresh()
    assert all("fidgety" not in x for x in table_state(h)["seats"])
    s = table_state(h, fidgety={"a": 0.9, "c": 0.1})
    assert (seat(s, "a")["fidgety"], seat(s, "c")["fidgety"]) == (0.9, 0.1)
    assert "fidgety" not in seat(s, "b")
