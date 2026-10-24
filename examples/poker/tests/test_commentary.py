import json

import pytest

from test_runner import RecordingVoice, agents_that, calling_agents, quiet
from vikaki_poker import Hand
from vikaki_poker.__main__ import main
from vikaki_poker.commentary import MAX_WORDS, Commentator, facts_of, moment_of, system_prompt, template_line
from vikaki_poker.llm import FakeLlm, LlmError
from vikaki_poker.runner import play_hand, play_session

HERE = __import__("os").path.dirname(__file__)
TABLE = __import__("os").path.join(HERE, "..", "table.example.yaml")


class DeskVoice(RecordingVoice):
    def commentate(self, text):
        self.calls.append(("commentate", text))


def test_the_moments_worth_a_line_are_the_opening_each_street_a_big_bet_the_showdown_and_the_win():
    assert moment_of({"kind": "new_hand", "text": "Hand 1"}, 1, 0) == "opening"
    assert moment_of({"kind": "new_hand", "text": "Hand 2"}, 2, 0) is None  # not every hand opens with a speech
    assert moment_of({"kind": "new_hand", "text": "Hand 6"}, 6, 0) == "opening"
    for kind in ("street", "showdown", "win"):
        assert moment_of({"kind": kind}, 3, 10) == kind
    assert moment_of({"kind": "raise", "amount": 40, "text": "Ada raises to 40"}, 3, 50) == "big bet"
    assert moment_of({"kind": "raise", "amount": 200, "text": "Ada goes all in for 200"}, 3, 500) == "all-in"
    assert moment_of({"kind": "raise", "amount": 4, "text": "Ada raises to 4"}, 3, 6) is None  # a small one
    assert moment_of({"kind": "check"}, 3, 10) is None and moment_of({"kind": "fold"}, 3, 10) is None


def test_the_facts_are_what_the_audience_sees_and_never_a_face_down_card():
    state = {"hand_no": 2, "street": "flop", "board": ["As", "Kd", "7h"], "pot": 24, "seats": [
        {"seat_id": "a", "stack": 90, "cards": ["back", "back"], "bet": 10},
        {"seat_id": "b", "stack": 80, "cards": ["Qs", "Qd"], "hand": "pair of queens", "win": 0.71},
        {"seat_id": "c", "stack": 0, "out": True, "cards": ["back", "back"], "folded": True},
    ]}
    text = facts_of(state, {"text": "Ben raises to 20"}, {"a": "ada", "b": "ben", "c": "cy"}, "big bet")
    assert "Board: As Kd 7h. Pot: 24." in text and "Ben: stack 80, shows pair of queens, 71% to win" in text and "Ada: stack 90, bet 10" in text
    assert "Cy: stack 0, folded, out of chips" in text
    assert "back" not in text and "Qs" not in text  # a card is never in the facts: only what the numbers say
    assert "never mention" in system_prompt("a style") and "a style" in system_prompt("a style")


def test_with_no_model_a_template_says_the_beat_plainly():
    state = {"board": ["As", "Kd", "7h"], "winners": [{"seat_id": "b", "amount": 40, "hand": "a pair of queens"}]}
    names = {"b": "ben"}
    assert template_line({"text": "Flop"}, state, names, "street") == "Flop: As Kd 7h."
    assert template_line({"text": "Win"}, state, names, "win") == "Ben takes 40 with a pair of queens."
    assert "big one" in template_line({"text": "Ada raises to 40"}, {}, names, "big bet")


def test_a_model_writes_the_line_and_it_is_cleaned_trimmed_and_never_longer_than_the_limit():
    long = "And here comes the river — a dramatic card for the table. " + " ".join(["word"] * 60)
    c = Commentator(FakeLlm([long]), "m", budget=3, min_gap=0)
    c.start_hand(1)
    text = c.line_for({"kind": "street", "text": "River"}, {"hand_no": 1, "seats": []}, 10, {})
    assert text and "—" not in text and len(text.split()) <= MAX_WORDS
    assert text.startswith("And here comes the river, a dramatic card")


def test_a_failing_model_falls_back_to_the_template_and_the_table_is_not_left_silent():
    class Broken:
        def complete(self, *a, **k):
            raise LlmError("boom")

    c = Commentator(Broken(), "m", budget=3, min_gap=0)
    c.start_hand(1)
    text = c.line_for({"kind": "street", "text": "Flop"}, {"board": ["As", "Kd", "7h"], "seats": []}, 0, {})
    assert text == "Flop: As Kd 7h." and c.failures == 1


def test_the_budget_keeps_one_line_for_the_result_and_the_gap_keeps_it_from_chattering():
    c = Commentator(None, "", budget=3, min_gap=2)
    c.start_hand(1)
    beats = [({"kind": "new_hand", "text": "Hand 1"}, 0), ({"kind": "street", "text": "Flop"}, 6), ({"kind": "street", "text": "Turn"}, 12),
             ({"kind": "street", "text": "River"}, 20), ({"kind": "showdown", "text": "Showdown"}, 20), ({"kind": "win", "text": "Win"}, 20)]
    said = [c.line_for(e, {"hand_no": 1, "board": [], "seats": [], "winners": [{"seat_id": "a", "amount": 20}]}, pot, {"a": "ada"}) for e, pot in beats]
    spoken = [i for i, t in enumerate(said) if t]
    assert len(spoken) <= 3 and spoken[-1] == 5  # the win is always the last of them
    assert all(b - a >= 2 for a, b in zip(spoken, spoken[1:-1]))  # apart, except that the result may follow closely
    c.start_hand(2)
    assert c.spoken == 0  # a new hand starts a new budget
    assert Commentator(None, "", budget=0).line_for({"kind": "win"}, {"seats": []}, 0, {}) is None


def test_the_commentator_speaks_between_turns_never_inside_one_within_its_budget_and_ends_on_the_win():
    voice = DeskVoice()
    commentator = Commentator(None, "", budget=3, min_gap=1)
    session = play_session(calling_agents(), voice, hands=3, stack=100, seed=9, out=quiet, commentator=commentator)
    assert session.hands_played == 3
    inside = None
    said = 0
    for call in voice.calls:
        if call[0] == "start":
            inside = call[1]
        elif call[0] == "end":
            inside = None
        elif call[0] == "commentate":
            assert inside is None, "the commentator talked over a player's turn"
            said += 1
    assert 3 <= said <= 9  # within three a hand, and at least one a hand
    assert voice.calls[-1][0] == "commentate" or any(c[0] == "commentate" for c in voice.calls[-6:])  # the last hand's result was called


def test_without_a_commentator_nothing_changes_and_a_voice_without_commentate_is_fine():
    voice = RecordingVoice()
    play_session(calling_agents(), voice, hands=1, stack=100, seed=9, out=quiet)
    assert not any(c[0] == "commentate" for c in voice.calls)
    lines = []
    play_session(calling_agents(), voice, hands=1, stack=100, seed=9, out=lines.append, commentator=Commentator(None, "", budget=2, min_gap=0))
    assert any("[commentary]" in line for line in lines)  # written to the log even where the voice cannot speak it


def test_the_command_line_has_the_commentary_and_its_budget(capsys):
    assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "2", "--no-reactions", "--commentary", "--commentary-budget", "2"]) == 0
    out = capsys.readouterr().out
    assert out.count("[commentary]") >= 2 and out.count("[commentary]") <= 4  # two a hand


def test_the_hub_voice_speaks_the_commentary_on_its_own_seat_and_persona_as_a_commentary_line(monkeypatch):
    import sys
    import types

    made = []

    class FakeClient:
        def __init__(self, url, token=None, seats=None, client=None):
            self.seats, self.said, self.closed = seats, [], False
            made.append(self)

        def say(self, text, *, seat_id, kind=None, **kw):
            self.said.append((text, seat_id, kind))
            return f"u{len(self.said)}"

        def wait_finished(self, uid, timeout=None):
            return {"type": "speech_finished", "utterance_id": uid}

        def close(self):
            self.closed = True

    fake = types.ModuleType("vikaki_client")
    fake.Vikaki = FakeClient
    fake.HubError = type("HubError", (Exception,), {})
    monkeypatch.setitem(sys.modules, "vikaki_client", fake)
    from vikaki_poker.runner import HubVoice

    voice = HubVoice("ws://x/ws", {"s1": "ada"}, commentator=("commentator", "desk"))
    voice.commentate("A big pot coming.")
    desk = next(c for c in made if c.seats[0]["seat_id"] == "commentator")
    assert desk.seats == [{"seat_id": "commentator", "persona": "desk"}]
    assert desk.said == [("A big pot coming.", "commentator", "commentary")]
    voice.close()
    assert all(c.closed for c in made)
    plain = HubVoice("ws://x/ws", {"s1": "ada"})
    plain.commentate("nobody hears this")  # no commentator seat: nothing is sent
    assert len(made) == 3 and made[-1].said == []
