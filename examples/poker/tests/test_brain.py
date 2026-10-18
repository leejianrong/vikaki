import pytest

from vikaki_poker import Hand
from vikaki_poker.brain import STRATEGY_PRIMER, Traits, briefing, history_text, personality_text, turn_facts
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


def test_the_personality_is_in_the_talk_and_never_in_the_play():
    tight = personality_text("ben", Traits(loose=0.1, aggressive=0.1, bluff=0.0, tricky=0.1, talkative=0.1, emotional=0.1), "careful")
    wild = personality_text("cy", Traits(loose=0.95, aggressive=0.95, bluff=0.9, tricky=0.9, talkative=0.95, emotional=0.9, quirk="hums when bluffing"), "fearless")
    for word in ("quiet", "calm", "careful"):
        assert word in tight
    for word in ("chatterbox", "heart on your sleeve", "hums when bluffing", "fearless"):
        assert word in wild
    assert tight != wild and "ben" in tight
    for text in (tight, wild):  # nothing here tells a seat to play more or fewer hands, to bluff, to bet more or to trap
        for banned in ("hands in every 100", "times in 10 if the spot", "slow-play", "play only premium", "you love to see flops"):
            assert banned not in text
        assert "Everyone at this table plays sound poker" in text
    # the style is only how it talks about the game
    assert "talk" in personality_text("x", Traits(loose=0.95)).lower()


def test_every_seat_gets_the_same_briefing_whatever_its_traits():
    _, view = view_for()
    wild = build_messages("cy", "", view, [], traits=Traits(loose=0.95, aggressive=0.95, bluff=0.9, tricky=0.9))
    tight = build_messages("ben", "", view, [], traits=Traits(loose=0.1, aggressive=0.1, bluff=0.0, tricky=0.1))
    assert wild[1] == tight[1]  # the turn's facts and the recommendation are the engine's, for everyone
    assert "personality" not in wild[1]["content"]
    assert "Play the recommended move" in wild[1]["content"]


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
    assert "ada raised to 8" in text and "you win about" in text and "need to win" in text and "The recommended move is" in text
    assert "ada: Big one." in text and "Your legal actions:" in text and "Opponents still in:" in text


def test_the_pot_odds_in_the_briefing_match_the_price_of_the_call():
    _, view = view_for(acts=[("a", "raise", 8)])
    facts = turn_facts(view)
    call = view["legal"]["call_amount"]
    assert facts["need"] == pytest.approx(call / (view["pot"] + call))
