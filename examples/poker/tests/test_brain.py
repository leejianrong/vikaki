import pytest

from vikaki_poker import Hand
from vikaki_poker.brain import STRATEGY_PRIMER, Traits, briefing, hands_to_play, history_text, personality_text, turn_facts
from vikaki_poker.seat import build_messages


def view_for(seed=4, acts=()):
    h = Hand([("a", 200), ("b", 200), ("c", 200)], 0, 1, 2, seed=seed)
    for seat, kind, *amount in acts:
        h.act(seat, kind, *amount)
    return h, h.view(h.to_act)


def test_traits_are_numbers_from_0_to_1_and_unknown_ones_are_named():
    assert Traits().loose == 0.5
    for bad in ({"loose": 1.5}, {"bluff": -0.1}, {"talkative": "very"}, {"tricky": True}):
        with pytest.raises(ValueError):
            Traits.from_dict(bad)
    with pytest.raises(ValueError, match="unknown trait 'fearless'.*aggressive"):
        Traits.from_dict({"fearless": 1})
    assert Traits.from_dict({"quirk": "hums", "bluff": 0.9}).bluff == 0.9


def test_the_personality_says_how_to_play_in_words_that_follow_the_numbers():
    tight = personality_text("ben", Traits(loose=0.1, aggressive=0.1, bluff=0.0, tricky=0.1, talkative=0.1, emotional=0.1), "careful")
    wild = personality_text("cy", Traits(loose=0.95, aggressive=0.95, bluff=0.9, tricky=0.9, talkative=0.95, emotional=0.9, quirk="hums when bluffing"), "fearless")
    for word in ("tight", "passive", "almost never bluff", "straightforward", "quiet", "calm"):
        assert word in tight
    for word in ("loose", "aggressive", "bold", "tricky", "chatterbox", "heart on your sleeve", "hums when bluffing"):
        assert word in wild
    assert "careful" in tight and "ben" in tight
    assert tight != wild
    assert "about 5 times in 10" in personality_text("x", Traits(bluff=0.5))


def test_a_trait_changes_the_instructions_a_seat_is_given():
    _, view = view_for()
    quiet = build_messages("ada", "", view, [], traits=Traits(talkative=0.0))[0]["content"]
    chatty = build_messages("ada", "", view, [], traits=Traits(talkative=1.0))[0]["content"]
    assert "quiet" in quiet and "chatterbox" not in quiet
    assert "chatterbox" in chatty and "quiet" not in chatty


def test_the_strategy_guide_is_in_every_seats_instructions_and_is_short():
    _, view = view_for()
    system = build_messages("ada", "", view, [])[0]["content"]
    assert STRATEGY_PRIMER in system
    assert 150 < len(STRATEGY_PRIMER.split()) < 400
    assert "keep the table light and kind" not in system  # that made them fold everything


def test_the_history_of_a_hand_is_told_street_by_street_with_names():
    h, _ = view_for(acts=[("a", "raise", 6)])
    h.act("b", "call")
    h.act("c", "fold")
    text = history_text(h.events, {"a": "ada", "b": "ben", "c": "cy"})
    assert text.startswith("Blinds: ben 1, cy 2.") and "Preflop: ada raised to 6, ben called 5, cy folded." in text
    h.act("b", "check")
    h.act("a", "raise", 10)
    assert "Flop: ben checked, ada raised to 10." in history_text(h.events, {"a": "ada", "b": "ben"}).replace("seat", "")
    assert history_text([], {}) == ""


def test_the_facts_come_from_what_the_seat_can_see_and_are_the_same_every_time():
    h, view = view_for()
    f1 = turn_facts(view)
    assert f1 == turn_facts(view)  # seeded by the situation: nothing random
    assert 0 < f1["win"] < 1 and f1["position"] in ("button", "small blind", "big blind")
    assert f1["tier"][1] in ("premium", "strong", "playable", "marginal", "weak")
    assert f1["advice"] in view["legal"]["kinds"]
    assert len(f1["opponents"]) == 2 and f1["call"] == view["legal"]["call_amount"]


def test_the_briefing_has_the_numbers_the_story_and_the_legal_moves_and_no_other_hands():
    h, view = view_for(acts=[("a", "raise", 8)])
    names = {"a": "ada", "b": "ben", "c": "cy"}
    seat = h.to_act
    text = briefing(view, turn_facts(view), history_text(h.events, names), [("a", "Big one.")], names)
    assert all(c in text for c in h.player(seat).hole)
    for other in h.seats:
        if other.seat_id != seat:
            assert not any(c in text for c in other.hole)
    assert "ada raised to 8" in text and "you win about" in text and "need to win" in text and "A rule of thumb says" in text
    assert "ada: Big one." in text and "Your legal actions:" in text and "Opponents still in:" in text


def test_the_pot_odds_in_the_briefing_match_the_price_of_the_call():
    _, view = view_for(acts=[("a", "raise", 8)])
    facts = turn_facts(view)
    call = view["legal"]["call_amount"]
    assert facts["need"] == pytest.approx(call / (view["pot"] + call))


def test_looseness_is_given_as_a_share_of_hands_to_play_and_grows_with_the_trait():
    assert [hands_to_play(x) for x in (0.0, 0.15, 0.5, 0.7, 0.95, 1.0)] == [10, 15, 25, 45, 65, 70]
    assert all(hands_to_play(a) <= hands_to_play(b) for a, b in zip([i / 20 for i in range(20)], [i / 20 for i in range(1, 21)]))
    assert "about 15 hands in every 100" in personality_text("ben", Traits(loose=0.15))
    assert "about 65 hands in every 100" in personality_text("cy", Traits(loose=0.95))
