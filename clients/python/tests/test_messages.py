from pathlib import Path

import pytest

from vikaki_client import InvalidMessage, make, schema, validate


def test_a_whole_line_and_a_streamed_chunk_are_accepted():
    make("utterance", seat_id="s1", utterance_id="u1", text="hi", emotion="smug", intensity=0.5, persona="ada", kind="banter")
    make("utterance", seat_id="s1", utterance_id="u1", delta="hel", final=False)


def test_unset_fields_are_left_out_and_the_version_is_filled_in():
    m = make("cancel", utterance_id=None)
    assert m == {"protocol_version": 1, "type": "cancel"}


def test_an_unknown_emotion_is_not_an_error():
    make("utterance", seat_id="s1", utterance_id="u1", text="hi", emotion="bewildered")


@pytest.mark.parametrize(
    "fields, why",
    [
        ({"text": "hi", "delta": "x"}, "exactly one"),  # both
        ({}, "exactly one"),  # neither
        ({"text": "hi", "final": True}, "`final` only goes with `delta`"),
        ({"text": ""}, "text"),  # empty
        ({"text": "hi", "intensity": 1.5}, "intensity"),
        ({"text": "hi", "kind": "shout"}, "kind"),
    ],
)
def test_utterances_that_break_the_protocol_are_refused_before_sending(fields, why):
    with pytest.raises(InvalidMessage, match=why):
        make("utterance", seat_id="s1", utterance_id="u1", **fields)


def test_the_error_names_the_field_at_fault():
    with pytest.raises(InvalidMessage) as err:
        make("utterance", seat_id="s1", utterance_id="u1", text="hi", intensity=2)
    assert "invalid utterance" in str(err.value) and "intensity" in str(err.value)


def test_other_messages_are_checked_too():
    make("turn_started", seat_id="s1", persona="ada")
    make("game_over", outcome="won", seat_id="s1")
    make("table_state", seats=[{"seat_id": "s1", "stack": 90, "cards": ["As", "back"]}], pot=10, board=["Td"], turn="s1")
    with pytest.raises(InvalidMessage):
        make("table_state", seats=[{"seat_id": "s1", "stack": -1}])
    with pytest.raises(InvalidMessage):
        make("game_over", outcome="tied")
    with pytest.raises(InvalidMessage):
        make("turn_started")  # no seat
    with pytest.raises(InvalidMessage, match="unknown message type"):
        validate({"protocol_version": 1, "type": "nonsense"})


def test_the_shipped_schema_is_the_one_this_repo_generates():
    committed = Path(__file__).resolve().parents[3] / "docs" / "protocol.schema.json"
    if not committed.exists():
        pytest.skip("not inside the vikaki repo, so there is nothing to compare with")
    import json

    assert schema() == json.loads(committed.read_text("utf-8")), "run `pnpm --filter @vikaki/protocol schema` (it rewrites both copies)"
