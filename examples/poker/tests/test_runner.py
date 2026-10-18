import json
import os
import re

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


# ---- silent reactions (VIK-58) ----

from vikaki_poker.reactions import ANSWERS, LlmReactor, MirrorReactor, Reaction, parse_reaction  # noqa: E402
from vikaki_poker.llm import LlmError  # noqa: E402


class ReactingVoice(RecordingVoice):
    def react(self, seat_id, reaction):
        self.calls.append(("react", seat_id, reaction.emotion, reaction.gesture))


def smug_calls(seats=("a", "b", "c")):
    say = json.dumps({"action": "call", "say": "Mine.", "emotion": "smug"})
    return agents_that(*[(s, [say]) for s in seats])


def test_mirror_reactor_answers_an_emotion_and_stays_still_for_neutral_speech_or_itself():
    r = MirrorReactor()
    assert r.react("b", "a", "Mine.", "smug") == ANSWERS["smug"]
    assert r.react("b", "a", "Mine.", None) is None
    assert r.react("b", "a", "Mine.", "neutral") is None
    assert r.react("a", "a", "Mine.", "smug") is None  # nobody reacts to themselves
    assert all(a.emotion in ("worried", "happy", "sad", "surprised") for a in ANSWERS.values())


def test_every_listener_reacts_to_a_line_after_it_is_heard_and_the_speaker_does_not():
    voice = ReactingVoice()
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), smug_calls(), voice, [], out=quiet, reactor=MirrorReactor())
    i = voice.calls.index(("say", "a", "Mine.", "smug"))
    assert voice.calls[i + 1 : i + 3] == [("react", "b", "worried", "tilt"), ("react", "c", "worried", "tilt")]  # right after the line, in seat order
    assert not any(c[:2] == ("react", "a") for c in voice.calls[i + 1 : i + 3])  # the speaker does not react to its own line
    assert ("end", "a") in voice.calls[i + 3 :]


def test_without_a_reactor_or_with_a_voice_that_cannot_react_nothing_changes():
    voice = ReactingVoice()
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), smug_calls(), voice, [], out=quiet)
    assert not [c for c in voice.calls if c[0] == "react"]
    plain = RecordingVoice()  # has no `react` at all
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), smug_calls(), plain, [], out=quiet, reactor=MirrorReactor())
    assert [c[0] for c in plain.calls][:3] == ["start", "say", "end"]


def test_a_reactor_that_breaks_does_not_stall_the_table():
    class Broken:
        def react(self, *a):
            raise RuntimeError("boom")

    voice = ReactingVoice()
    hand = Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4)
    play_hand(hand, smug_calls(), voice, [], out=quiet, reactor=Broken())
    assert hand.complete and not [c for c in voice.calls if c[0] == "react"]


def test_parse_reaction_reads_a_reply_and_returns_none_for_anything_unusable_or_still():
    assert parse_reaction('{"emotion": "happy", "gesture": "nod"}') == Reaction("happy", "nod")
    assert parse_reaction('```json\n{"emotion": "surprised", "gesture": "none"}\n```') == Reaction("surprised", None)
    assert parse_reaction('{"emotion": "neutral", "gesture": "shake"}') == Reaction(None, "shake")
    assert parse_reaction('{"emotion": "neutral", "gesture": "none"}') is None
    assert parse_reaction('{"emotion": "ecstatic", "gesture": "dance"}') is None
    assert parse_reaction("I would smile.") is None


def test_the_model_reactor_asks_each_listener_in_character_and_counts_the_cost():
    llm = FakeLlm(['{"emotion": "worried", "gesture": "tilt"}'])
    r = LlmReactor(llm, "cheap-model", {"a": ("ada", "warm"), "b": ("ben", "nervous")})
    assert r.react("b", "a", "I raise!", "smug") == Reaction("worried", "tilt")
    req = llm.requests[0]
    assert req["model"] == "cheap-model" and req["max_tokens"] == 40
    assert "ben" in req["messages"][0]["content"] and "nervous" in req["messages"][0]["content"]
    assert 'ada just said: "I raise!" (looking smug)' in req["messages"][1]["content"]
    assert r.usage.calls == 1
    assert r.react("a", "a", "I raise!", "smug") is None and len(llm.requests) == 1  # it does not ask a seat about its own line


def test_a_model_that_fails_means_no_reaction():
    class Down:
        def complete(self, *a, **k):
            raise LlmError("down")

    assert LlmReactor(Down(), "m", {}).react("b", "a", "hi", None) is None


def test_the_dry_run_command_reacts_by_default_and_not_with_no_reactions(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "1"]) == 0
    assert "reacts:" in capsys.readouterr().out
    assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "1", "--no-reactions"]) == 0
    assert "reacts:" not in capsys.readouterr().out


def test_a_table_file_may_name_a_reaction_model(tmp_path):
    from vikaki_poker.table import build_reactor

    text = open(TABLE, encoding="utf-8").read()
    path = tmp_path / "t.yaml"
    path.write_text(re.sub(r"# reaction_model: \S+", "reaction_model: tiny", text).replace("personas_file: ../../", f"personas_file: {os.path.abspath(os.path.join(HERE, '..', '..', '..'))}/"), encoding="utf-8")
    table = load_table(str(path))
    assert table.reaction_model == "tiny"
    assert isinstance(build_reactor(table, FakeLlm(["{}"])), LlmReactor)
    assert isinstance(build_reactor(table, None), MirrorReactor)  # no model to ask: the fixed table
    assert isinstance(build_reactor(load_table(TABLE), FakeLlm(["{}"])), MirrorReactor)


# ---- the table state for the overlay (VIK-61) ----


class ShowingVoice(RecordingVoice):
    def table_state(self, state):
        self.calls.append(("table", state["turn"] if "turn" in state else None, state["street"], state["pot"]))


def test_the_overlay_is_told_at_the_start_and_after_every_move_with_the_turn_marker_following_the_play():
    agents = agents_that(("a", [json.dumps({"action": "call"})]), ("b", [json.dumps({"action": "call"})]), ("c", [json.dumps({"action": "check"})]))
    voice = ShowingVoice()
    hand = Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4)
    play_hand(hand, agents, voice, [], out=quiet)
    shown = [c for c in voice.calls if c[0] == "table"]
    moves = [c for c in voice.calls if c[0] == "start"]
    assert len(shown) == len(moves) + 1  # once at the start, then after each move
    assert shown[0][1] == moves[0][1] and shown[0][2] == "preflop"  # the first state already points at who plays first
    assert shown[-1][1] is None and shown[-1][3] == 0  # the last: nobody to act, the pot paid out
    # the state after a move comes before the next seat's turn starts, so the marker is on the next player when they start thinking
    for state, nxt in zip(shown[1:], moves[1:]):
        assert state[1] == nxt[1]


def test_the_voice_that_cannot_show_a_table_is_left_alone_and_show_cards_reaches_the_state():
    plain = RecordingVoice()
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents_that(("a", ["{}"]), ("b", ["{}"]), ("c", ["{}"])), plain, [], out=quiet)
    assert plain.calls[0][0] == "start"  # no table_state method, no error

    seen = []

    class Spy(RecordingVoice):
        def table_state(self, state):
            seen.append(state)

    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents_that(("a", ["{}"]), ("b", ["{}"]), ("c", ["{}"])), Spy(), [], out=quiet, show_cards=True)
    assert seen[0]["seats"][0]["cards"] != ["back", "back"]
