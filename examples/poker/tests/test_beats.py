from vikaki_poker import Hand
from vikaki_poker.beats import action_event, new_hand_event, showdown_event, street_event, win_event
from vikaki_poker.pace import PACES, Pace
from test_hand import rig

NAMES = {"a": "ada", "b": "ben", "c": "cy"}


def test_an_action_is_a_kind_a_seat_an_amount_and_words_the_page_can_show():
    assert action_event({"type": "fold", "seat_id": "b", "street": "flop"}, NAMES) == {"kind": "fold", "seat_id": "b", "text": "Ben folds"}
    assert action_event({"type": "check", "seat_id": "a", "street": "flop"}, NAMES) == {"kind": "check", "seat_id": "a", "text": "Ada checks"}
    assert action_event({"type": "call", "seat_id": "c", "street": "flop", "amount": 12}, NAMES) == {"kind": "call", "seat_id": "c", "amount": 12, "text": "Cy calls 12"}
    assert action_event({"type": "raise", "seat_id": "a", "street": "flop", "amount": 30}, NAMES)["text"] == "Ada raises to 30"
    assert action_event({"type": "raise", "seat_id": "a", "street": "flop", "amount": 80, "all_in": True}, NAMES)["text"] == "Ada goes all in for 80"
    assert action_event({"type": "call", "seat_id": "z", "street": "flop", "amount": 1}, {})["text"] == "Z calls 1"  # no name known: the seat id


def test_the_other_beats_have_their_words():
    assert new_hand_event(7) == {"kind": "new_hand", "text": "Hand 7"}
    assert street_event("flop") == {"kind": "street", "text": "Flop"}
    assert showdown_event() == {"kind": "showdown", "text": "Showdown"}


def _finished(stacks, holes, board, _acts=None):
    ids = list("abc"[: len(stacks)])
    h = Hand(list(zip(ids, stacks)), 0, 1, 2, deck=rig(ids, 0, holes, board), staged=True)
    while not h.complete:
        if h.awaiting:
            h.advance()
        else:
            leg = h.legal()
            h.act(leg.seat_id, "check" if leg.can_check else "call")
    return h


def test_a_win_says_who_won_how_much_and_with_what():
    h = _finished([100, 100], {"a": "As Ah", "b": "7c 2d"}, "Ks 9d 4c 3h 8s", None)
    event, winners = win_event(h, NAMES)
    assert winners == [{"seat_id": "a", "amount": 4, "hand": "pair of aces"}]
    assert event == {"kind": "win", "seat_id": "a", "amount": 4, "text": "Ada wins 4 with a pair of aces"}


def test_the_hand_reads_naturally_after_with():
    from vikaki_poker.beats import _with

    assert [_with(h) for h in ("pair of aces", "two pair, aces and kings", "three of a kind, aces", "straight, nine high", "flush, ace high", "full house, aces over kings", "four of a kind, kings", "ace high", "straight flush, five high")] == [
        "a pair of aces", "two pair, aces and kings", "three of a kind, aces", "a straight, nine high", "a flush, ace high", "a full house, aces over kings", "four of a kind, kings", "ace high", "a straight flush, five high",
    ]


def test_a_hand_won_because_everyone_folded_shows_no_cards():
    h = Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=1, staged=True)
    h.act("a", "fold")
    h.act("b", "fold")
    h.advance()
    event, winners = win_event(h, NAMES)
    assert winners == [{"seat_id": "c", "amount": 3}] and event["text"] == "Cy wins 3"


def test_a_split_pot_names_each_winner():
    h = _finished([100, 100], {"a": "As Kh", "b": "Ad Kc"}, "2s 7d 9c Jh 4s", None)
    event, winners = win_event(h, NAMES)
    assert sorted(w["seat_id"] for w in winners) == ["a", "b"] and sum(w["amount"] for w in winners) == 4
    assert "Ada wins 2" in event["text"] and "Ben wins 2" in event["text"]


def test_the_pace_waits_for_each_kind_of_beat_scaled_and_not_at_all_when_off():
    slept: list[float] = []
    normal = Pace(PACES["normal"], sleep=slept.append)
    for kind in ("fold", "street", "win", "new_hand", "showdown"):
        normal.wait(kind)
    assert slept == [1.75, 2.5, 3.5, 2.5, 3.0]
    slept.clear()
    Pace(PACES["fast"], sleep=slept.append).wait("street")
    Pace(PACES["slow"], sleep=slept.append).wait("street")
    Pace(PACES["off"], sleep=slept.append).wait("street")
    Pace(1.0, sleep=slept.append).wait("an unknown beat")
    assert slept == [1.25, 3.75]
