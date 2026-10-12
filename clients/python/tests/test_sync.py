import threading

import pytest

from vikaki_client import HubError, InvalidMessage, Vikaki


def client_threads():
    return [t for t in threading.enumerate() if t.name == "vikaki-client"]


def test_blocking_calls_speak_and_wait(hub):
    with Vikaki(hub.url) as v:
        uid = v.say("Fold.", seat_id="seat-1", emotion="sad")
        done = v.wait_finished(uid, timeout=5)
        v.turn_started("seat-1")
        v.cancel()
        v.game_over("lost")
        assert v.welcome["type"] == "welcome" and not v.closed
    assert done["type"] == "speech_finished"
    assert [m["type"] for m in hub.wait_received(5)] == ["hello", "utterance", "turn_started", "cancel", "game_over"]


def test_a_stream_from_an_ordinary_generator(hub):
    def tokens():
        yield from ["One. ", "Two. ", "Three."]

    with Vikaki(hub.url) as v:
        uid = v.say_stream(tokens(), seat_id="s")
        assert v.wait_finished(uid, timeout=5)["utterance_id"] == uid
    deltas = [m for m in hub.wait_received(4) if m["type"] == "utterance"]
    assert [m["delta"] for m in deltas] == ["One. ", "Two. ", "Three."] and deltas[-1]["final"] is True


def test_a_refused_message_raises_in_the_callers_thread(hub):
    with Vikaki(hub.url) as v:
        with pytest.raises(InvalidMessage):
            v.say("hi", seat_id="s", kind="shout")


def test_listeners_hear_events(hub):
    heard = threading.Event()
    kinds = []
    with Vikaki(hub.url) as v:
        v.on_event(lambda e: (kinds.append(e["type"]), heard.set() if e["type"] == "speech_finished" else None))
        v.say("hi", seat_id="s")
        assert heard.wait(5)
    assert kinds == ["speech_started", "speech_finished"]


def test_the_thread_stops_on_close_and_on_a_failed_connect(hub):
    before = len(client_threads())
    with pytest.raises(HubError):
        Vikaki("ws://127.0.0.1:1/ws", timeout=2)
    v = Vikaki(hub.url)
    v.close()
    v.close()  # safe twice
    assert len(client_threads()) == before
