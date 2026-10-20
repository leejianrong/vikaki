import threading
import time

from vikaki_poker.pace import Pace
from vikaki_poker.transport import Transport


def run_gate(t: Transport) -> threading.Thread:
    th = threading.Thread(target=t.gate, daemon=True)
    th.start()
    return th


def test_a_running_game_passes_the_gate_at_once_and_tells_the_pages_it_is_not_paused():
    told: list[bool] = []
    t = Transport(told.append)
    t.gate()
    assert told == [False]


def test_a_paused_game_holds_at_the_gate_until_play():
    t = Transport()
    t.handle("pause")
    th = run_gate(t)
    th.join(0.4)
    assert th.is_alive()
    t.handle("play")
    th.join(2)
    assert not th.is_alive() and not t.paused


def test_a_step_lets_exactly_one_beat_through_and_then_holds_again():
    told: list[bool] = []
    t = Transport(told.append)
    t.handle("pause")
    first = run_gate(t)
    first.join(0.3)
    assert first.is_alive()
    t.handle("step")
    first.join(2)
    assert not first.is_alive() and t.paused  # one beat out, still paused
    second = run_gate(t)
    second.join(0.4)
    assert second.is_alive()  # and the next beat holds
    t.handle("play")
    second.join(2)
    assert not second.is_alive()
    assert told == [True, True]  # each beat that held told the pages the game was paused


def test_a_step_while_running_pauses_and_a_stray_action_is_ignored():
    t = Transport()
    t.handle("step")
    assert t.paused
    t.handle("explode")
    assert t.paused


def test_the_pace_calls_the_gate_after_every_beat_even_with_no_pause():
    calls: list[str] = []
    p = Pace(0.0, gate=lambda: calls.append("gate"))
    p.wait("check")
    p.wait("raise", 1.0)
    assert calls == ["gate", "gate"]
