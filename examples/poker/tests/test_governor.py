from vikaki_poker.brain import Traits
from vikaki_poker.governor import Governor, budget_for


def test_the_budget_follows_the_talkative_trait():
    quiet, middling, chatty = (budget_for(t) for t in (0.1, 0.5, 0.9))
    assert quiet.max_words < middling.max_words < chatty.max_words
    assert quiet.cooldown > middling.cooldown > chatty.cooldown
    assert quiet.max_words == 6


def test_a_line_over_the_word_cap_is_dropped_and_noted():
    g = Governor()
    said, note = g.vet("a", 0, "flop", "one two three four five six seven", Traits(talkative=0.1))
    assert said == ""
    assert "7 words" in note and "6" in note


def test_one_line_per_seat_per_street():
    g = Governor()
    t = Traits(talkative=0.9)
    assert g.vet("a", 0, "flop", "Nice board.", t) == ("Nice board.", "")
    said, note = g.vet("a", 0, "flop", "Again!", t)
    assert said == "" and "street" in note
    assert g.vet("a", 0, "turn", "Again!", t)[0] == "Again!"  # a new street
    assert g.vet("a", 1, "turn", "New hand.", t)[0] == "New hand."  # a new hand is a new turn on the same street name
    assert g.vet("b", 0, "turn", "Mine.", t)[0] == "Mine."  # other seats have their own


def test_a_cooldown_after_speaking_counts_the_seats_own_turns():
    g = Governor()
    t = Traits(talkative=0.1)  # cooldown 3
    assert g.vet("a", 0, "preflop", "Hi.", t)[0] == "Hi."
    for street in ("flop", "turn", "river"):  # three turns of silence, said or not
        said, note = g.vet("a", 0, street, "Hm.", t)
        assert said == "" and "cooldown" in note
    assert g.vet("a", 1, "preflop", "Back.", t)[0] == "Back."


def test_silence_costs_nothing_and_is_not_noted():
    assert Governor().vet("a", 0, "flop", "", Traits()) == ("", "")
