import pytest

from vikaki_poker.seat import parse_performance
from vikaki_poker.voice import VOICE, clean


@pytest.mark.parametrize(
    "said, wanted",
    [
        ("Nice hand — I fold.", "Nice hand, I fold."),
        ("Two pair – not bad.", "Two pair, not bad."),
        ("Well--that hurt", "Well, that hurt"),
        ("Wait —.", "Wait."),
        ("No dashes here, just a plain-spoken range of 5-10.", "No dashes here, just a plain-spoken range of 5-10."),  # a hyphen is fine
    ],
)
def test_dashes_become_commas_and_hyphens_stay(said, wanted):
    assert clean(said) == wanted


@pytest.mark.parametrize(
    "said, wanted",
    [
        ("The engine says call.", "My head says call."),
        ("the engine's right, I think", "My head's right, I think"),
        ("I think the engine's right", "I think my head's right"),
        ("Engine wants me to fold", "My head wants me to fold"),
    ],
)
def test_the_engine_is_just_their_head(said, wanted):
    assert clean(said) == wanted


def test_what_a_model_writes_is_cleaned_before_anyone_sees_it():
    reply = '{"think": "The engine says fold — fine, playing it straight.", "say": "Too rich for me — sorry.", "emotion": "sad"}'
    p = parse_performance(reply)
    assert "—" not in p.think + p.say and "engine" not in p.think.lower()
    assert p.say == "Too rich for me, sorry."


def test_the_guide_itself_uses_no_dashes_and_names_no_engine_to_copy():
    assert "—" not in VOICE and "–" not in VOICE
    assert "poker head" in VOICE
