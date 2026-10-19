import json

import pytest

from scripted import engine_from
from vikaki_poker import Hand
from vikaki_poker.llm import FakeLlm
from vikaki_poker.monologue import Monologue, clip, critical_moment
from vikaki_poker.runner import PrintVoice, play_hand
from vikaki_poker.seat import SeatAgent


def view(*, pot=20, stack=100, bet=0, call=0):
    return {"pot": pot, "players": [{"seat_id": "a", "stack": stack, "bet": bet, "folded": False, "all_in": False}], "legal": {"kinds": ["fold", "call", "raise"], "call_amount": call}}


def test_what_counts_as_a_critical_moment():
    assert critical_moment(view(stack=50), "a", "raise", 50, 0.5, 2) == "all-in"
    assert critical_moment(view(stack=40, call=40), "a", "call", None, 0.5, 2) == "all-in"
    assert critical_moment(view(pot=30), "a", "raise", 24, 0.5, 2) == "a big bet"
    assert critical_moment(view(pot=30, call=20), "a", "call", None, 0.5, 2) == "a big call"
    assert critical_moment(view(call=10), "a", "fold", None, 0.45, 2) == "a strong hand folded"
    # the ordinary moves are not
    assert critical_moment(view(pot=30), "a", "raise", 6, 0.5, 2) is None  # a small raise
    assert critical_moment(view(pot=200, call=20), "a", "call", None, 0.5, 2) is None  # a big-looking call into a huge pot
    assert critical_moment(view(call=10), "a", "fold", None, 0.1, 2) is None  # a weak hand folded
    assert critical_moment(view(), "a", "check", None, 0.9, 2) is None


def test_a_spoken_thought_is_short_and_ends_on_a_sentence():
    long = "I have a pair of nines and they have been betting hard all night. Maybe it is a bluff. " + "word " * 40
    spoken = clip(long)
    assert len(spoken.split()) <= 30 and spoken.endswith(".")
    assert clip("Short one.") == "Short one."


def test_a_seat_thinks_aloud_once_a_hand_and_only_when_the_mode_allows():
    m = Monologue("critical")
    assert not m.speaks(0, "a", None)
    assert m.speaks(0, "a", "all-in")
    assert not m.speaks(0, "a", "all-in")  # once a hand
    assert m.speaks(1, "a", "all-in")
    assert Monologue("all").speaks(0, "a", None)
    assert not Monologue("off").speaks(0, "a", "all-in")
    with pytest.raises(ValueError):
        Monologue("loud")


class Voice(PrintVoice):
    def __init__(self) -> None:
        super().__init__(lambda _: None)
        self.calls: list[tuple] = []

    def say(self, seat_id, text, emotion, to=None):
        self.calls.append(("say", seat_id, text))

    def think(self, seat_id, text, aloud=False):
        self.calls.append(("aloud" if aloud else "think", seat_id, text))


def shove_table(thought="I have to go all in. Please hold."):
    reply = json.dumps({"think": thought, "say": "All in.", "emotion": "worried", "action": "raise", "amount": 100})
    call = json.dumps({"think": "A call, then.", "say": "", "action": "call"})
    return {
        "a": SeatAgent("a", "ada", FakeLlm([reply, call, call]), "m", engine=engine_from([reply, call, call])),
        "b": SeatAgent("b", "ben", FakeLlm([call]), "m", engine=engine_from([call])),
    }


def play(mode):
    voice, agents = Voice(), shove_table()
    play_hand(Hand([("a", 100), ("b", 100)], 0, 1, 2, seed=3), agents, voice, [], out=lambda _: None, monologue=Monologue(mode))
    return voice


def test_an_all_in_is_thought_aloud_before_the_line_is_said():
    calls = play("critical").calls
    aloud = [c for c in calls if c[0] == "aloud"]
    assert aloud and aloud[0][1:] == ("a", "I have to go all in. Please hold.")
    assert calls.index(aloud[0]) < calls.index(("say", "a", "All in."))
    assert ("think", "a", "I have to go all in. Please hold.") not in calls  # spoken, so not sent twice


def test_off_keeps_every_thought_as_text():
    calls = play("off").calls
    assert not [c for c in calls if c[0] == "aloud"]
    assert ("think", "a", "I have to go all in. Please hold.") in calls


def test_a_seat_that_went_broke_is_asked_what_it_thinks_and_says_it_aloud():
    voice = play("critical")
    broke = [c for c in voice.calls if c[0] == "aloud" and c[1] in ("a", "b")]
    assert len(broke) >= 2  # the all-in, and the hand's end for someone (a showdown, a win or going broke)
