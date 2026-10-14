import json

import pytest

from vikaki_poker import Hand
from vikaki_poker.llm import FakeLlm, LlmError, Usage
from vikaki_poker.seat import Decision, SeatAgent, build_messages, parse_decision

FACING_BET = {"kinds": ["fold", "call", "raise"], "call_amount": 2, "min_raise_to": 4, "max_raise_to": 100}
FREE = {"kinds": ["fold", "check", "raise"], "call_amount": 0, "min_raise_to": 2, "max_raise_to": 100}
NO_RAISE = {"kinds": ["fold", "call"], "call_amount": 5, "min_raise_to": 0, "max_raise_to": 0}


def reply(**kw) -> str:
    return json.dumps(kw)


def test_a_clean_answer_is_used_as_given():
    d = parse_decision(reply(action="raise", amount=10, say="Big one.", emotion="smug"), FACING_BET)
    assert d == Decision("raise", 10, "Big one.", "smug", "")
    assert parse_decision(reply(action="fold"), FACING_BET).action == "fold"
    assert parse_decision(reply(action="call"), FACING_BET).action == "call"


def test_json_inside_a_code_fence_or_words_is_found():
    assert parse_decision('Sure!\n```json\n{"action": "fold", "say": "bye"}\n```', FACING_BET).action == "fold"
    assert parse_decision('I think {"action": "call"} is right', FACING_BET).action == "call"


@pytest.mark.parametrize("text", ["", "I fold.", "{not json", "[1, 2]", '{"action": 7}', '{"action": "dance"}'])
def test_an_unusable_answer_becomes_check_when_free_and_fold_when_owing(text):
    assert parse_decision(text, FREE).action == "check"
    d = parse_decision(text, FACING_BET)
    assert d.action == "fold" and d.note


def test_an_illegal_action_falls_back_but_keeps_the_table_talk():
    d = parse_decision(reply(action="check", say="Free card!", emotion="happy"), FACING_BET)  # something is owed: cannot check
    assert d.action == "fold" and d.say == "Free card!" and d.emotion == "happy" and "not legal" in d.note
    assert parse_decision(reply(action="raise", amount=50), NO_RAISE).action == "fold"


def test_call_when_nothing_is_owed_means_check():
    d = parse_decision(reply(action="call"), FREE)
    assert d.action == "check" and "call read as check" in d.note


def test_a_raise_outside_the_legal_range_is_moved_into_it():
    assert parse_decision(reply(action="raise", amount=3), FACING_BET).amount == 4
    assert parse_decision(reply(action="raise", amount=5000), FACING_BET).amount == 100
    d = parse_decision(reply(action="raise", amount=3), FACING_BET)
    assert "moved to 4" in d.note


def test_a_raise_with_a_missing_or_odd_amount_is_the_minimum_raise():
    for amount in (None, "lots", True, [5]):
        d = parse_decision(reply(action="raise", amount=amount), FACING_BET)
        assert d.action == "raise" and d.amount == 4 and d.note
    assert parse_decision(reply(action="raise", amount="12"), FACING_BET).amount == 12
    assert parse_decision(reply(action="raise", amount=12.9), FACING_BET).amount == 12


def test_bet_and_all_in_are_read_as_raises():
    assert parse_decision(reply(action="bet", amount=20), FREE).amount == 20
    d = parse_decision(reply(action="all-in"), FACING_BET)
    assert d.action == "raise" and d.amount == 100


def test_emotion_must_be_one_of_the_seven_and_the_line_is_tidied_and_capped():
    assert parse_decision(reply(action="fold", emotion="furious"), FACING_BET).emotion is None
    d = parse_decision(reply(action="fold", say="  hello \n  there  " + "x" * 500), FACING_BET)
    assert d.say.startswith("hello there x") and len(d.say) <= 240
    assert parse_decision(reply(action="fold", say=42), FACING_BET).say == ""


def make_view(seat: str = "a") -> tuple[Hand, dict]:
    h = Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=3)
    return h, h.view(h.to_act)


def test_the_prompt_shows_own_cards_and_the_legal_moves_but_not_other_hands():
    h, view = make_view()
    seat = h.to_act
    messages = build_messages("ada", "warm, quick-witted", view, [("b", "Nice weather."), ("c", "Indeed.")])
    text = "\n".join(m["content"] for m in messages)
    assert messages[0]["role"] == "system" and "ada" in messages[0]["content"] and "warm, quick-witted" in messages[0]["content"]
    assert all(card in text for card in h.player(seat).hole)
    for other in h.seats:
        if other.seat_id != seat:
            assert not any(card in text for card in other.hole)
    assert "call (costs 2)" in text and "raise (to a total between 4 and 100)" in text and "fold" in text
    assert "b: Nice weather. | c: Indeed." in text


def test_only_the_most_recent_talk_is_included():
    _, view = make_view()
    talk = [("b", f"line {i}") for i in range(20)]
    text = build_messages("ada", "", view, talk)[1]["content"]
    assert "line 19" in text and "line 12" in text and "line 11" not in text


def test_the_agent_asks_its_model_and_keeps_count():
    h, view = make_view()
    llm = FakeLlm([reply(action="call", say="Fine.")])
    agent = SeatAgent(h.to_act, "ada", llm, "deepseek/deepseek-chat", "warm", max_tokens=150)
    d = agent.decide(view, [("b", "hi")])
    assert d.action == "call" and d.say == "Fine."
    assert llm.requests[0]["model"] == "deepseek/deepseek-chat" and llm.requests[0]["max_tokens"] == 150
    agent.decide(view)
    assert agent.usage.calls == 2 and agent.usage.prompt_tokens > 0


def test_a_failing_model_never_stalls_the_seat():
    class Broken:
        def complete(self, messages, *, model, max_tokens):
            raise LlmError("the model service answered HTTP 500")

    h, view = make_view()
    d = SeatAgent(h.to_act, "ada", Broken(), "m").decide(view)  # type: ignore[arg-type]
    assert d.action == "fold" and "HTTP 500" in d.note
    assert Usage().calls == 0
