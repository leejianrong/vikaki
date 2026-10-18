import json

import pytest
from scripted import always

from vikaki_poker import Hand
from vikaki_poker.llm import FakeLlm, LlmError, Usage
from vikaki_poker.seat import MAX_SAY, MAX_THINK, Decision, SeatAgent, build_messages, parse_performance
from vikaki_poker.strategy import Move

MOVE = Move("call", None, "about 40% to win against what they could hold; worth +1.2 chips (fold +0.0)", 0.4)


def reply(**kw) -> str:
    return json.dumps(kw)


def test_a_clean_reply_gives_the_words_the_thought_and_the_feeling():
    p = parse_performance(reply(think="Pair of kings.", say="Big one.", emotion="smug"))
    assert (p.say, p.think, p.emotion, p.note) == ("Big one.", "Pair of kings.", "smug", "")


def test_json_inside_a_code_fence_or_words_is_found():
    assert parse_performance('Sure!\n```json\n{"say": "Hello.", "emotion": "happy"}\n```').say == "Hello."
    assert parse_performance('prefix {"say": "Hi"} suffix').say == "Hi"


@pytest.mark.parametrize("text", ["", "I fold", "[1, 2]", "{broken json"])
def test_a_reply_with_no_usable_json_is_silence_and_says_so(text):
    p = parse_performance(text)
    assert (p.say, p.think, p.emotion) == ("", "", None) and p.note


def test_an_action_in_the_reply_is_ignored_because_the_model_does_not_decide_the_move():
    p = parse_performance(reply(action="raise", amount=999, say="All in!", think="Shove."))
    assert p.say == "All in!" and not hasattr(p, "action") and not hasattr(p, "amount")


def test_emotion_must_be_one_of_the_seven_and_the_words_are_tidied_and_capped():
    assert parse_performance(reply(emotion="furious")).emotion is None
    assert parse_performance(reply(say="  two   words\n")).say == "two words"
    assert len(parse_performance(reply(say="x" * 900)).say) == MAX_SAY
    assert parse_performance(reply(say=5, think=["a"])).say == "" and parse_performance(reply(think=7)).think == ""
    assert len(parse_performance(reply(think="y" * 900)).think) == MAX_THINK


def make_view() -> tuple[Hand, dict]:
    h = Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=3)
    return h, h.view(h.to_act)


def test_the_prompt_shows_own_cards_the_move_and_the_talk_but_not_other_hands():
    h, view = make_view()
    seat = h.to_act
    messages = build_messages("ada", "warm, quick-witted", view, [("b", "Nice weather."), ("c", "Indeed.")], MOVE)
    text = "\n".join(m["content"] for m in messages)
    assert messages[0]["role"] == "system" and "ada" in messages[0]["content"] and "warm, quick-witted" in messages[0]["content"]
    assert all(card in text for card in h.player(seat).hole)
    for other in h.seats:
        if other.seat_id != seat:
            assert not any(card in text for card in other.hole)
    assert "already decided: call" in text and "b: Nice weather. | c: Indeed." in text


def test_only_the_most_recent_talk_is_included():
    _, view = make_view()
    text = build_messages("ada", "", view, [("b", f"line {i}") for i in range(20)], MOVE)[1]["content"]
    assert "line 19" in text and "line 12" in text and "line 11" not in text


def test_the_agent_makes_the_engines_move_and_the_model_supplies_only_the_words():
    h, view = make_view()
    llm = FakeLlm([reply(say="Fine.", think="A fair price.", emotion="happy")])
    agent = SeatAgent(h.to_act, "ada", llm, "deepseek/deepseek-chat", "warm", max_tokens=150, engine=always("call"))
    d = agent.decide(view, [("b", "hi")])
    assert (d.action, d.say, d.think, d.emotion) == ("call", "Fine.", "A fair price.", "happy")
    assert "scripted" in d.note or d.note  # the engine's reason travels with the move
    assert llm.requests[0]["model"] == "deepseek/deepseek-chat" and llm.requests[0]["max_tokens"] == 150
    agent.decide(view)
    assert agent.usage.calls == 2 and agent.usage.prompt_tokens > 0


def test_a_model_that_demands_a_different_move_changes_nothing():
    h, view = make_view()
    llm = FakeLlm([reply(action="raise", amount=100, say="All in!", think="I shove.")])
    d = SeatAgent(h.to_act, "cy", llm, "m", engine=always("fold")).decide(view)
    assert d.action == "fold" and d.amount is None


def test_a_failing_model_never_stalls_the_seat_and_the_engines_move_still_stands():
    class Broken:
        def complete(self, messages, *, model, max_tokens):
            raise LlmError("the model service answered HTTP 500")

    h, view = make_view()
    d = SeatAgent(h.to_act, "ada", Broken(), "m", engine=always("call")).decide(view)  # type: ignore[arg-type]
    assert d.action == "call" and d.say == "" and "HTTP 500" in d.note
    assert Usage().calls == 0


def test_an_unreadable_reply_leaves_the_move_and_a_silent_seat():
    h, view = make_view()
    d = SeatAgent(h.to_act, "ada", FakeLlm(["I shall say nothing in JSON"]), "m", engine=always("call")).decide(view)
    assert (d.action, d.say, d.think) == ("call", "", "") and "no JSON" in d.note


def test_the_real_engine_is_used_by_default_and_its_move_is_legal():
    h, view = make_view()
    agent = SeatAgent(h.to_act, "ada", FakeLlm([reply(say="Hmm.")]), "m", samples=60, seed=1)
    d = agent.decide(view, events=h.events)
    assert d.action in view["legal"]["kinds"] and d.note  # the reason of the engine is in the note
    assert isinstance(d, Decision)
    agent.reseed(5)
    first = agent.decide(view, events=h.events)
    agent.reseed(5)
    again = agent.decide(view, events=h.events)
    assert (first.action, first.amount) == (again.action, again.amount)  # the same seed, the same move


@pytest.mark.parametrize("seed", range(6))
def test_whatever_the_personality_the_move_is_the_same(seed):
    """The separation of play from character (ADR-0026): two seats with opposite traits and quirks, and models begging for an all-in, play the same move."""
    from vikaki_poker.brain import Traits

    h = Hand([("a", 100), ("b", 100), ("c", 100)], seed % 3, 1, 2, seed=seed)
    wild = Traits(talkative=1, loose=1, aggressive=1, bluff=1, tricky=1, emotional=1, quirk="loves a gamble and an all-in, never folds")
    tame = Traits(talkative=0, loose=0, aggressive=0, bluff=0, tricky=0, emotional=0, quirk="folds everything and apologises")
    shove = FakeLlm([reply(action="raise", amount=100, say="ALL IN!", think="Shove it.")])
    fold = FakeLlm([reply(action="fold", say="Sorry.", think="Too scary.")])
    cy = SeatAgent(h.to_act, "cy", shove, "m", traits=wild, samples=60, seed=seed)
    ben = SeatAgent(h.to_act, "ben", fold, "m", traits=tame, samples=60, seed=seed)
    while not h.complete:
        view = h.view(h.to_act)
        a, b = cy.decide(view, events=h.events), ben.decide(view, events=h.events)
        assert (a.action, a.amount) == (b.action, b.amount)
        h.act(h.to_act, a.action, a.amount)


NAMES = {"a": "ada", "b": "ben", "c": "cy"}


@pytest.mark.parametrize(
    "to, expected",
    [("ben", "b"), ("Ben", "b"), (" cy ", "c"), ("table", None), ("everyone", None), ("all", None), ("", None), ("nobody I know", None), ("ada", None), (5, None)],
)
def test_who_a_line_is_for_is_read_from_the_name_and_anything_else_is_the_whole_table(to, expected):
    """The reply's "to" is a player's name; the seat id of that player is kept. Talking to oneself, to the table or to no one known is talking to the table."""
    h, view = make_view()
    seat = "a"
    llm = FakeLlm([reply(say="Hello there.", to=to)])
    d = SeatAgent(seat, "ada", llm, "m", engine=always("call")).decide(view, names=NAMES)
    assert d.to == expected and d.say == "Hello there."


def test_the_prompt_asks_who_the_line_is_for():
    _, view = make_view()
    system = build_messages("ada", "", view, [], MOVE)[0]["content"]
    assert '"to"' in system and "table" in system
