import json
import os

import pytest

from vikaki_poker import Hand
from vikaki_poker.__main__ import main
from vikaki_poker.llm import FakeLlm
from vikaki_poker.runner import PrintVoice, play_hand, play_session
from vikaki_poker.seat import Decision, SeatAgent
from vikaki_poker.table import TableError, build_agents, load_table

HERE = os.path.dirname(__file__)
TABLE = os.path.join(HERE, "..", "table.example.yaml")


class RecordingVoice:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def turn_started(self, seat_id):
        self.calls.append(("start", seat_id))

    def say(self, seat_id, text, emotion):
        self.calls.append(("say", seat_id, text, emotion))

    def turn_ended(self, seat_id):
        self.calls.append(("end", seat_id))


def agents_that(*replies_by_seat: tuple[str, list[str]]) -> dict[str, SeatAgent]:
    return {seat: SeatAgent(seat, f"p-{seat}", FakeLlm(replies), "m") for seat, replies in replies_by_seat}


def quiet(*_):
    pass


def test_each_move_is_think_then_speak_then_act_and_the_table_talks_one_at_a_time():
    say = json.dumps({"action": "call", "say": "Count me in.", "emotion": "happy"})
    agents = agents_that(("a", [say]), ("b", [say]), ("c", [say]))
    voice = RecordingVoice()
    hand = Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4)
    result = play_hand(hand, agents, voice, [], out=quiet)
    assert hand.complete and sum(hand.final_stacks().values()) == 300
    first = voice.calls[:3]
    assert first == [("start", "a"), ("say", "a", "Count me in.", "happy"), ("end", "a")]
    kinds = [c[0] for c in voice.calls]
    assert kinds == ["start", "say", "end"] * (len(kinds) // 3)  # never two seats mid-move
    assert any("wins" in line for line in result.log)


def test_seats_hear_what_the_others_said():
    agents = agents_that(("a", [json.dumps({"action": "call", "say": "Pineapple on pizza."})]), ("b", [json.dumps({"action": "call"})]), ("c", [json.dumps({"action": "check"})]))
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents, RecordingVoice(), [], out=quiet)
    prompt_b = agents["b"].llm.requests[0]["messages"][1]["content"]  # type: ignore[attr-defined]
    assert "a: Pineapple on pizza." in prompt_b


def test_a_seat_that_says_nothing_is_not_spoken_for():
    agents = agents_that(("a", ['{"action": "fold"}']), ("b", ['{"action": "fold"}']), ("c", ['{"action": "check"}']))
    voice = RecordingVoice()
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents, voice, [], out=quiet)
    assert [c[0] for c in voice.calls if c[0] == "say"] == []
    assert voice.calls[0] == ("start", "a") and voice.calls[1] == ("end", "a")


def test_garbage_from_every_model_still_finishes_the_hand_and_notes_why():
    agents = agents_that(("a", ["lol no"]), ("b", ["{"]), ("c", [""]))
    result = play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents, RecordingVoice(), [], out=quiet)
    assert result.hand.complete
    assert any("no JSON in the reply" in line for line in result.log)


def test_if_the_engine_ever_refuses_a_move_the_table_does_not_stall():
    class Wrong:
        usage = None

        def decide(self, view, talk=None):
            return Decision("raise", 99999)  # never legal

    agents = {"a": Wrong(), "b": Wrong()}
    result = play_hand(Hand([("a", 50), ("b", 50)], 0, 1, 2, seed=1), agents, RecordingVoice(), [], out=quiet)  # type: ignore[arg-type]
    assert result.hand.complete and any("engine refused" in line for line in result.log)


def calling_agents(n: int = 3) -> dict[str, SeatAgent]:
    return agents_that(*[(f"s{i}", [json.dumps({"action": "call", "say": f"s{i} here"}), json.dumps({"action": "raise", "amount": 30, "say": "Up!"})]) for i in range(n)])


def test_a_session_moves_the_button_and_conserves_chips():
    session = play_session(calling_agents(), RecordingVoice(), hands=4, stack=100, seed=9, out=quiet)
    assert session.hands_played == 4
    assert sum(session.stacks.values()) == 300
    firsts = [next(e["seat_id"] for e in r.hand.events if e["type"] != "blind") for r in session.results]  # who acts first in each hand
    assert len(set(firsts)) > 1


def test_the_same_seed_plays_the_same_session():
    a = play_session(calling_agents(), RecordingVoice(), hands=3, stack=100, seed=2, out=quiet)
    b = play_session(calling_agents(), RecordingVoice(), hands=3, stack=100, seed=2, out=quiet)
    assert a.stacks == b.stacks and [r.log for r in a.results] == [r.log for r in b.results]


def test_a_player_with_no_chips_sits_out_and_the_session_stops_when_one_is_left():
    session = play_session(agents_that(("a", ['{"action": "raise", "amount": 20}']), ("b", ['{"action": "call"}'])), RecordingVoice(), hands=50, stack=10, seed=5, out=quiet)
    assert session.hands_played < 50 and sorted(session.stacks.values())[0] == 0 and sum(session.stacks.values()) == 20


def test_print_voice_prints_the_line():
    lines: list[str] = []
    PrintVoice(lines.append).say("seat-1", "Hello.", "happy")
    assert lines == ["  seat-1 (happy): Hello."]


def test_the_example_table_file_loads_with_each_characters_style():
    table = load_table(TABLE)
    assert [s.seat_id for s in table.seats] == ["seat-1", "seat-2", "seat-3"]
    assert table.personas() == {"seat-1": "ada", "seat-2": "ben", "seat-3": "cy"}
    assert "warm" in table.seats[0].style and "worrier" in table.seats[1].style
    assert table.seats[0].model.startswith("deepseek/") and (table.stack, table.small_blind, table.big_blind) == (200, 1, 2)
    agents = build_agents(table, FakeLlm(["x"]))
    assert agents["seat-2"].persona == "ben" and agents["seat-2"].max_tokens == 200


@pytest.mark.parametrize(
    "text, message",
    [
        ("seats: {a: {persona: ada, model: m}}", "at least two"),
        ("seats: {a: {persona: ada}, b: {persona: ben, model: m}}", "`model` is required"),
        ("seats: {a: {model: m}, b: {persona: ben, model: m}}", "`persona` is required"),
        ("stack: -5\nseats: {a: {persona: x, model: m}, b: {persona: y, model: m}}", "positive whole number"),
        ("small_blind: 5\nbig_blind: 2\nseats: {a: {persona: x, model: m}, b: {persona: y, model: m}}", "small_blind"),
        ("- a list", "must hold a mapping"),
        ("seats: [unclosed", "not valid YAML"),
    ],
)
def test_a_bad_table_file_says_what_is_wrong(tmp_path, text, message):
    f = tmp_path / "t.yaml"
    f.write_text(text)
    with pytest.raises(TableError, match=message):
        load_table(str(f))


def test_a_default_model_fills_seats_that_name_none(tmp_path):
    f = tmp_path / "t.yaml"
    f.write_text("seats: {a: {persona: x}, b: {persona: y}}")
    assert [s.model for s in load_table(str(f), default_model="deepseek/deepseek-chat").seats] == ["deepseek/deepseek-chat"] * 2


def test_the_command_plays_a_dry_run_with_the_fake_llm_and_no_key(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)  # so no .env is found
    code = main(["play", "--table", TABLE, "--hands", "2", "--seed", "3", "--fake-llm", "--no-hub"])
    out = capsys.readouterr().out
    assert code == 0 and "--- hand 1" in out and "chips: " in out and "model use:" in out and "wins" in out


def test_without_a_key_the_command_says_so_and_does_not_start(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)
    assert main(["play", "--table", TABLE, "--no-hub"]) == 2
    assert "OPENROUTER_API_KEY" in capsys.readouterr().err


def test_a_bad_table_file_is_a_clean_error(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["play", "--table", str(tmp_path / "nope.yaml"), "--fake-llm", "--no-hub"]) == 2
    assert "cannot read" in capsys.readouterr().err
