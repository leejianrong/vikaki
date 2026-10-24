import json
import os
import re
import threading
import time

import pytest

from scripted import engine_from
from vikaki_poker import Hand
from vikaki_poker.brain import Traits
from vikaki_poker.__main__ import main
from vikaki_poker.llm import FakeLlm
from vikaki_poker.rebuy import Rebuys
from vikaki_poker.runner import PrintVoice, play_hand, play_session
from vikaki_poker.seat import Decision, SeatAgent
from vikaki_poker.table import TableError, build_agents, load_table

HERE = os.path.dirname(__file__)
TABLE = os.path.join(HERE, "..", "table.example.yaml")
TABLE6 = os.path.join(HERE, "..", "table6.example.yaml")


class RecordingVoice:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def turn_started(self, seat_id):
        self.calls.append(("start", seat_id))

    def say(self, seat_id, text, emotion, to=None):
        self.calls.append(("say", seat_id, text, emotion) if to is None else ("say", seat_id, text, emotion, to))

    def turn_ended(self, seat_id):
        self.calls.append(("end", seat_id))

    def think(self, seat_id, text):
        self.calls.append(("think", seat_id, text))


def agents_that(*replies_by_seat: tuple[str, list[str]]) -> dict[str, SeatAgent]:
    return {seat: SeatAgent(seat, f"p-{seat}", FakeLlm(replies), "m", engine=engine_from(replies)) for seat, replies in replies_by_seat}


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
    kinds = "".join({"start": "[", "say": "s", "end": "]", "think": ""}[c[0]] for c in voice.calls)
    assert re.fullmatch(r"(\[s?\])+", kinds)  # never two seats mid-move; the governor drops a second line in a street
    assert any("wins" in line for line in result.log)


def test_a_private_thought_goes_to_the_audience_and_never_into_another_seats_prompt():
    secret = "SECRET-PLAN-7"
    move = json.dumps({"think": secret, "action": "call", "say": "I call."})
    agents = agents_that(("a", [move]), ("b", [json.dumps({"action": "call"})]), ("c", [json.dumps({"action": "check"})]))
    voice = RecordingVoice()
    talk: list = []
    result = play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents, voice, talk, out=quiet)
    assert ("think", "a", secret) in voice.calls
    assert result.thoughts and result.thoughts[0] == ("a", secret)
    assert voice.calls.index(("think", "a", secret)) < voice.calls.index(("say", "a", "I call.", None))  # it comes before the line
    assert not any(secret in str(t) for t in talk)  # the table's chat holds only what was said
    for seat in "bc":
        assert not any(secret in m["content"] for r in agents[seat].llm.requests for m in r["messages"])  # type: ignore[attr-defined]


def test_the_governor_drops_a_line_over_budget_and_the_log_says_so():
    long = json.dumps({"action": "call", "say": "one two three four five six seven eight nine ten eleven"})
    agents = agents_that(("a", [long]), ("b", [json.dumps({"action": "call"})]), ("c", [json.dumps({"action": "check"})]))
    agents["a"].traits = Traits(talkative=0.1)
    voice = RecordingVoice()
    result = play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents, voice, [], out=quiet)
    assert not any(c[0] == "say" for c in voice.calls)
    assert result.said == []
    assert any("line dropped: 11 words" in line for line in result.log)


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
    assert any("no JSON in the model's reply" in line for line in result.log)


def test_if_the_engine_ever_refuses_a_move_the_table_does_not_stall():
    class Wrong:
        usage = None
        traits = Traits()

        persona = "wrong"

        def decide(self, view, talk=None, events=None, names=None):
            return Decision("raise", 99999)  # never legal

    agents = {"a": Wrong(), "b": Wrong()}
    result = play_hand(Hand([("a", 50), ("b", 50)], 0, 1, 2, seed=1), agents, RecordingVoice(), [], out=quiet)  # type: ignore[arg-type]
    assert result.hand.complete and any("engine refused" in line for line in result.log)


def calling_agents(n: int = 3) -> dict[str, SeatAgent]:
    return agents_that(*[(f"s{i}", [json.dumps({"action": "call", "say": f"s{i} here"}), json.dumps({"action": "raise", "amount": 30, "say": "Up!"})]) for i in range(n)])


def test_a_session_moves_the_button_and_conserves_chips():
    session = play_session(calling_agents(), RecordingVoice(), hands=4, stack=100, seed=9, out=quiet, rebuy=False)
    assert session.hands_played == 4
    assert sum(session.stacks.values()) == 300
    firsts = [next(e["seat_id"] for e in r.hand.events if e["type"] != "blind") for r in session.results]  # who acts first in each hand
    assert len(set(firsts)) > 1


def test_the_same_seed_plays_the_same_session():
    a = play_session(calling_agents(), RecordingVoice(), hands=3, stack=100, seed=2, out=quiet)
    b = play_session(calling_agents(), RecordingVoice(), hands=3, stack=100, seed=2, out=quiet)
    assert a.stacks == b.stacks and [r.log for r in a.results] == [r.log for r in b.results]


def test_a_player_with_no_chips_sits_out_and_the_session_stops_when_one_is_left():
    session = play_session(agents_that(("a", ['{"action": "raise", "amount": 20}']), ("b", ['{"action": "call"}'])), RecordingVoice(), hands=50, stack=10, seed=5, out=quiet, rebuy=False)
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
    assert agents["seat-2"].persona == "ben" and agents["seat-2"].max_tokens == 300


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
    assert hand.complete and not [c for c in voice.calls if c[0] == "react" and c[2:] == ("worried", "tilt")]  # none of the broken reactor's; the move reactions (VIK-134) are the game's own


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


def test_a_seat_is_told_who_everyone_is_and_what_has_happened_this_hand():
    seen = []

    class Spy:
        persona = "spy"
        usage = None
        traits = Traits()

        def decide(self, view, talk=None, events=None, names=None):
            seen.append((view["to_act"], [e["type"] for e in events], dict(names)))
            return Decision("check" if "check" in view["legal"]["kinds"] else "call")

    agents = {s: Spy() for s in "abc"}
    agents["a"].persona, agents["b"].persona, agents["c"].persona = "ada", "ben", "cy"
    play_hand(Hand([("a", 50), ("b", 50), ("c", 50)], 0, 1, 2, seed=4), agents, RecordingVoice(), [], out=quiet)  # type: ignore[arg-type]
    assert seen[0][2] == {"a": "ada", "b": "ben", "c": "cy"}
    assert seen[0][1] == ["blind", "blind"]  # the first to act has seen only the blinds
    assert len(seen[-1][1]) > len(seen[0][1])  # and later seats see what the others did


def _table(tmp_path, seat_extra: str):
    path = tmp_path / "t.yaml"
    path.write_text(f"seats:\n  a: {{persona: ada, model: m{seat_extra}}}\n  b: {{persona: ben, model: m}}\n", encoding="utf-8")
    return str(path)


def test_a_seat_may_carry_traits_that_reach_its_agent(tmp_path):
    from vikaki_poker.table import build_agents

    table = load_table(_table(tmp_path, ", traits: {talkative: 0.9, loose: 0.1, quirk: 'hums'}"))
    t = table.seats[0].traits
    assert (t.talkative, t.loose, t.quirk) == (0.9, 0.1, "hums")
    assert table.seats[1].traits.loose == 0.5  # no traits: a middling player
    agents = build_agents(table, FakeLlm(["{}"]))
    assert agents["a"].traits.talkative == 0.9


def test_bad_traits_are_refused_naming_the_seat_and_the_trait(tmp_path):
    import pytest

    from vikaki_poker.table import TableError

    with pytest.raises(TableError, match="seat a: traits: trait loose must be a number from 0 to 1"):
        load_table(_table(tmp_path, ", traits: {loose: 3}"))
    with pytest.raises(TableError, match="unknown trait 'fearless'"):
        load_table(_table(tmp_path, ", traits: {fearless: 1}"))
    with pytest.raises(TableError, match="`traits` must be a mapping"):
        load_table(_table(tmp_path, ", traits: wild"))


def test_the_example_table_gives_the_three_seats_different_personalities():
    table = load_table(TABLE)
    loose = [s.traits.loose for s in table.seats]
    assert max(loose) - min(loose) > 0.5  # one tight, one wild: that is the point
    assert len({s.traits.quirk for s in table.seats}) == 3


def test_a_player_who_goes_broke_buys_back_in_and_the_session_goes_on():
    lines: list[str] = []
    agents = agents_that(("a", ['{"action": "raise", "amount": 20}']), ("b", ['{"action": "call"}']))
    session = play_session(agents, RecordingVoice(), hands=12, stack=10, seed=5, out=lines.append)
    assert session.hands_played == 12  # nobody was left out: the table did not stop at the first bust
    assert sum(session.rebuys.values()) >= 1
    assert any("buys back in for 10" in line for line in lines)
    assert all(v > 0 for v in session.stacks.values())
    # chips are conserved apart from the rebuys: what is on the table is the starting stacks plus every rebuy
    assert sum(session.stacks.values()) == 2 * 10 + 10 * sum(session.rebuys.values())


def test_stack_and_blinds_can_be_set_on_the_command_line(capsys):
    assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "1", "--stack", "60", "--blinds", "5/10", "--no-reactions"]) == 0
    out = capsys.readouterr().out
    assert "--- hand 1: seat-1 60, seat-2 60, seat-3 60" in out
    # the big blind was 10: the hand's first lines are played over blinds of 5 and 10, so the stacks are no longer all 60 after it
    assert "chips:" in out and "seat-1 60, seat-2 60, seat-3 60" not in out.split("chips:")[1].splitlines()[0]


def test_bad_stack_or_blinds_are_refused_saying_what_is_wrong(capsys):
    for args, message in [
        (["--stack", "0"], "--stack must be a positive"),
        (["--blinds", "10"], "--blinds must look like 5/10"),
        (["--blinds", "a/b"], "--blinds must look like 5/10"),
        (["--blinds", "10/5"], "small blind no bigger"),
        (["--blinds", "0/2"], "small blind no bigger"),
        (["--stack", "10", "--blinds", "5/10"], "under two big blinds"),
    ]:
        assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", *args]) == 2, args
        assert message in capsys.readouterr().err, args


class InterruptingAgent:
    """Checks or calls, until the user presses Ctrl-C while it is thinking (after `moves` moves)."""

    def __init__(self, moves: int) -> None:
        self.persona, self.usage, self.traits = "ctrl", None, Traits()
        self._moves = moves

    def decide(self, view, talk=None, events=None, names=None):
        if self._moves <= 0:
            raise KeyboardInterrupt
        self._moves -= 1
        return Decision("check" if "check" in view["legal"]["kinds"] else "call")


def test_ctrl_c_ends_the_session_cleanly_and_keeps_the_hands_already_played():
    agents = {"a": InterruptingAgent(14), "b": InterruptingAgent(10**6), "c": InterruptingAgent(10**6)}  # a few hands in
    session = play_session(agents, RecordingVoice(), hands=50, stack=50, seed=3, out=quiet)  # type: ignore[arg-type]
    assert session.interrupted
    assert 1 <= session.hands_played < 50
    assert len(session.results) == session.hands_played  # the hand cut short is not counted


def test_main_says_so_and_still_prints_the_summary_when_interrupted(capsys, monkeypatch):
    import vikaki_poker.__main__ as cli

    real = cli.play_session

    def interrupted(*a, **kw):
        s = real(*a, **{**kw, "hands": 1})
        s.interrupted = True
        return s

    monkeypatch.setattr(cli, "play_session", interrupted)
    code = main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "5"])
    out = capsys.readouterr().out
    assert code == 130
    assert "interrupted" in out and "chips:" in out


class BeatVoice(RecordingVoice):
    def __init__(self) -> None:
        super().__init__()
        self.states: list[dict] = []

    def table_state(self, state):
        self.states.append(state)


def _pace(slept):
    from vikaki_poker.pace import Pace

    return Pace(1.0, sleep=slept.append)


def test_an_all_in_is_shown_beat_by_beat_with_a_pause_after_each():
    shove = json.dumps({"action": "raise", "amount": 50})
    call = json.dumps({"action": "call"})
    agents = agents_that(("a", [shove]), ("b", [call]))
    voice = BeatVoice()
    slept: list[float] = []
    hand = Hand([("a", 50), ("b", 50)], 0, 1, 2, seed=4, staged=True)
    result = play_hand(hand, agents, voice, [], out=quiet, pace=_pace(slept), hand_no=6)
    events = [s["event"]["kind"] for s in voice.states if "event" in s]
    assert events == ["new_hand", "raise", "call", "street", "street", "street", "showdown", "win"]
    streets = [(s["street"], len(s["board"])) for s in voice.states if s.get("event", {}).get("kind") == "street"]
    assert streets == [("flop", 3), ("turn", 4), ("river", 5)]  # the turn and the river are seen, one at a time
    assert slept == pytest.approx([3.0, 5.4, 2.8 + 2.0 * 48 / 52, 3.2, 3.2, 3.2, 3.5, 4.0])  # the shove and the call it draws sit longer (VIK-134)
    assert voice.states[0]["hand_no"] == 7  # shown to people as hand 7
    last = voice.states[-1]
    assert last["event"]["kind"] == "win" and last["winners"] and last["pot"] == 0
    assert sum(w["amount"] for w in last["winners"]) == 100 and result.hand.complete


def test_the_pot_is_still_on_the_table_when_the_showdown_is_shown_and_paid_in_the_win():
    shove = json.dumps({"action": "raise", "amount": 50})
    voice = BeatVoice()
    play_hand(Hand([("a", 50), ("b", 50)], 0, 1, 2, seed=4, staged=True), agents_that(("a", [shove]), ("b", [json.dumps({"action": "call"})])), voice, [], out=quiet)
    show = next(s for s in voice.states if s.get("event", {}).get("kind") == "showdown")
    assert show["pot"] == 100 and "winners" not in show


def test_without_a_pace_nothing_waits():
    agents = agents_that(("a", [json.dumps({"action": "call"})]), ("b", [json.dumps({"action": "check"})]))
    voice = BeatVoice()
    play_hand(Hand([("a", 50), ("b", 50)], 0, 1, 2, seed=4, staged=True), agents, voice, [], out=quiet)  # the default pace is off
    assert voice.states  # and it finished at once


def test_a_session_plays_staged_hands_numbered_from_one_and_paced():
    slept: list[float] = []
    agents = agents_that(("a", [json.dumps({"action": "call"})]), ("b", [json.dumps({"action": "check"})]))
    voice = BeatVoice()
    play_session(agents, voice, hands=2, stack=50, seed=3, out=quiet, pace=_pace(slept))
    assert [s["hand_no"] for s in voice.states if s.get("event", {}).get("kind") == "new_hand"] == [1, 2]
    assert slept and all(t >= 2.2 for t in slept)  # a beat is never rushed


def test_the_pace_option_defaults_to_normal_with_a_hub_and_off_without(monkeypatch):
    import vikaki_poker.__main__ as cli

    seen = []
    real = cli.play_session

    def spy(*a, **kw):
        seen.append(kw["pace"].scale)
        return real(*a, **{**kw, "hands": 1, "pace": cli.Pace(0.0)})

    monkeypatch.setattr(cli, "play_session", spy)
    for extra in (["--no-hub"], ["--no-hub", "--pace", "slow"], ["--no-hub", "--pace", "fast"]):
        assert main(["play", "--table", TABLE, "--fake-llm", "--no-reactions", "--hands", "1", *extra]) == 0
    assert seen == [0.0, 1.5, 0.5]


def test_without_a_seed_each_game_is_dealt_afresh_and_says_which_seed_to_repeat_it_with(capsys):
    seeds = []
    for _ in range(2):
        assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "1", "--no-reactions"]) == 0
        seeds.append(re.search(r"seed (\d+)", capsys.readouterr().out).group(1))  # type: ignore[union-attr]
    assert seeds[0] != seeds[1]
    assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "1", "--no-reactions", "--seed", "7"]) == 0
    assert "seed 7" in capsys.readouterr().out


def test_a_line_for_one_player_reaches_the_voice_and_the_table_talk_with_its_addressee():
    line = json.dumps({"say": "Nice try, Ben.", "to": "ben", "emotion": "smug"})
    agents = agents_that(("a", [line]), ("b", [json.dumps({"say": "Hm."})]), ("c", [json.dumps({"say": "Fine."})]))
    for seat, agent in agents.items():
        agent.persona = {"a": "ada", "b": "ben", "c": "cy"}[seat]
    voice = RecordingVoice()
    talk: list = []
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents, voice, talk, out=quiet)
    said = [c for c in voice.calls if c[0] == "say" and c[1] == "a"]
    assert said and said[0] == ("say", "a", "Nice try, Ben.", "smug", "b")
    assert ("a", "Nice try, Ben.", "b") in talk


def test_the_addressee_reacts_even_to_a_neutral_line_and_a_bystander_does_not():
    r = MirrorReactor()
    assert r.react("b", "a", "Mine.", None) is None
    assert r.react("b", "a", "Mine.", None, addressed=True) is not None
    assert r.react("b", "a", "Mine.", "smug", addressed=True).seconds > (r.react("b", "a", "Mine.", "smug").seconds or 0)


def test_the_listening_model_is_told_when_the_line_was_for_it():
    llm = FakeLlm([json.dumps({"emotion": "worried", "gesture": "nod"})])
    LlmReactor(llm, "m", {"a": ("ada", ""), "b": ("ben", "")}).react("b", "a", "Nice try.", None, addressed=True)
    assert "to you" in llm.requests[0]["messages"][1]["content"]


def test_the_others_take_a_shove_with_a_startled_reaction_and_the_shover_does_not_react_to_itself():
    from vikaki_poker.reactions import MirrorReactor

    shove = json.dumps({"action": "raise", "amount": 100})
    agents = agents_that(("a", [shove]), ("b", [json.dumps({"action": "fold"})]), ("c", [json.dumps({"action": "call"})]))
    voice = ReactingVoice()
    play_hand(Hand([("a", 100), ("b", 100), ("c", 100)], 0, 1, 2, seed=4), agents, voice, [], out=quiet, reactor=MirrorReactor())
    after = voice.calls[voice.calls.index(("end", "a")) + 1 :]
    first = [c for c in after[: after.index(next(c for c in after if c[0] == "start"))] if c[0] == "react"]
    assert {c[1] for c in first} == {"b", "c"}  # everyone still in, never the shover
    assert all(c[2] == "surprised" for c in first)  # an all-in startles the table


# ---- buying back in (VIK-108) ----


class ClickingVoice(RecordingVoice):
    """A voice for a page whose audience clicks "Buy back in" on every broke seat the table shows while it asks."""

    def __init__(self, rebuys, clicks: bool = True) -> None:
        super().__init__()
        self.rebuys, self.clicks = rebuys, clicks
        self.states: list[dict] = []

    def table_state(self, state):
        self.states.append(state)
        if self.clicks and state.get("rebuy") == "ask":
            for seat in state["seats"]:
                if seat.get("out"):
                    self.rebuys.request(seat["seat_id"])


def shove_agents():
    return agents_that(("a", ['{"action": "raise", "amount": 20}']), ("b", ['{"action": "call"}']))


def test_with_never_a_broke_player_is_out_and_the_session_ends_with_a_winner():
    session = play_session(shove_agents(), RecordingVoice(), hands=30, stack=10, seed=5, out=quiet, rebuy="never")
    assert session.hands_played < 30 and not session.rebuys
    assert sorted(session.stacks.values()) == [0, 20]


def test_with_ask_a_broke_player_stays_out_until_the_audience_asks_and_then_is_dealt_in_at_the_next_hand():
    rebuys = Rebuys("ask")
    unattended = play_session(shove_agents(), ClickingVoice(rebuys, clicks=False), hands=30, stack=10, seed=5, out=quiet, rebuy=rebuys)
    assert unattended.hands_played < 30 and not unattended.rebuys  # nobody asked: it ends as never does
    rebuys = Rebuys("ask")
    lines: list[str] = []
    asked = play_session(shove_agents(), ClickingVoice(rebuys), hands=12, stack=10, seed=5, out=lines.append, rebuy=rebuys)
    assert asked.hands_played == 12 and sum(asked.rebuys.values()) >= 1
    assert any("buys back in for 10" in line for line in lines)
    assert sum(asked.stacks.values()) == 2 * 10 + 10 * sum(asked.rebuys.values())


def test_a_table_that_asks_waits_for_a_request_when_one_player_is_left_and_ends_when_none_comes():
    class Late(ClickingVoice):
        def table_state(self, state):  # the click comes a moment after the table shows the broke seat
            self.states.append(state)
            if state.get("rebuy") == "ask" and any(s.get("out") for s in state["seats"]):
                threading.Timer(0.05, lambda: [self.rebuys.request(s["seat_id"]) for s in state["seats"] if s.get("out")]).start()

    rebuys = Rebuys("ask")
    session = play_session(shove_agents(), Late(rebuys), hands=3, stack=10, seed=5, out=quiet, rebuy=rebuys, rebuy_wait=2.0)
    assert session.hands_played == 3 and sum(session.rebuys.values()) >= 1
    rebuys = Rebuys("ask")
    started = time.monotonic()
    ended = play_session(shove_agents(), ClickingVoice(rebuys, clicks=False), hands=30, stack=10, seed=5, out=quiet, rebuy=rebuys, rebuy_wait=0.2)
    assert ended.hands_played < 30 and time.monotonic() - started < 5


def test_requests_are_ignored_unless_the_policy_is_ask_and_stale_ones_are_dropped():
    for policy in ("auto", "never"):
        r = Rebuys(policy)
        r.request("a")
        assert r.grant(["a"]) == (["a"] if policy == "auto" else [])  # auto grants by itself, never not at all: the click changes nothing
    r = Rebuys("ask")
    r.request("a")
    assert r.grant(["b"]) == []  # a was not broke: the request is stale
    assert r.grant(["a"]) == []  # and it is gone, not kept for later
    r.request("a")
    assert r.grant(["a", "b"]) == ["a"]
    assert Rebuys(True).policy == "auto" and Rebuys(False).policy == "never"
    with pytest.raises(ValueError):
        Rebuys("sometimes")


def test_the_table_state_carries_the_policy_and_lists_a_broke_seat_with_nothing():
    rebuys = Rebuys("ask")
    voice = ClickingVoice(rebuys, clicks=False)
    play_session(shove_agents(), voice, hands=30, stack=10, seed=5, out=quiet, rebuy=rebuys)
    assert voice.states and all(s.get("rebuy") == "ask" for s in voice.states)
    last = voice.states[-1]
    assert sorted(x["stack"] for x in last["seats"]) == [0, 20]
    assert [x["seat_id"] for x in last["seats"] if x.get("out")] == [next(x["seat_id"] for x in last["seats"] if x["stack"] == 0)]
    mid = [s for s in voice.states if any(x["stack"] == 0 and not x.get("out") for x in s["seats"])]
    assert mid, "an all-in seat has a stack of 0 too, and is not out"


def test_the_command_line_takes_rebuy_ask_auto_never_and_still_the_old_no_rebuy(capsys):
    for flags in (["--rebuy", "never"], ["--no-rebuy"], ["--rebuy", "ask"]):
        assert main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--hands", "1", "--no-reactions", *flags]) == 0
    capsys.readouterr()
    with pytest.raises(SystemExit):
        main(["play", "--table", TABLE, "--fake-llm", "--no-hub", "--rebuy", "sometimes"])


def test_the_six_seat_example_table_loads_with_its_personas_and_plays_a_hand(capsys):
    table = load_table(TABLE6)
    assert [s.persona for s in table.seats] == ["ada", "ben", "cy", "fifi", "leo", "mo"]
    assert len({s.persona for s in table.seats}) == 6
    assert main(["play", "--table", TABLE6, "--fake-llm", "--no-hub", "--hands", "2", "--no-reactions", "--seed", "4"]) == 0
    out = capsys.readouterr().out
    assert "hand 2" in out and "fifi" in out


def test_a_move_on_the_bluff_route_is_marked_in_the_log_so_a_run_can_be_checked_for_how_the_models_took_it():
    class Bluffer:
        persona = "bluffer"
        usage = None
        traits = Traits()

        def decide(self, view, talk=None, events=None, names=None):
            kinds = view["legal"]["kinds"]
            return Decision("check" if "check" in kinds else "call", bluffing=view["to_act"] == "a")

    agents = {s: Bluffer() for s in "ab"}
    lines: list[str] = []
    play_hand(Hand([("a", 50), ("b", 50)], 0, 1, 2, seed=4), agents, RecordingVoice(), [], out=lines.append)  # type: ignore[arg-type]
    assert any("a call [bluff route]" in line or "a check [bluff route]" in line for line in lines)
    assert not any("b call [bluff route]" in line or "b check [bluff route]" in line for line in lines)
