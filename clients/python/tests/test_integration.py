"""Against a real hub: `vikaki serve --tts fake --port 8787`, then `VIKAKI_HUB_URL=ws://127.0.0.1:8787/ws pytest -m integration`.
Skipped when VIKAKI_HUB_URL is not set, so the plain test run needs no Node."""

import os

import pytest

from vikaki_client import Vikaki

URL = os.environ.get("VIKAKI_HUB_URL")
pytestmark = [pytest.mark.integration, pytest.mark.skipif(not URL, reason="VIKAKI_HUB_URL not set")]


def test_a_line_is_spoken_and_reported_finished_by_the_real_hub():
    with Vikaki(URL) as v:
        uid = v.say("Hello from Python.", seat_id="seat-1", emotion="happy")
        done = v.wait_finished(uid, timeout=30)
    assert done["type"] == "speech_finished" and done["utterance_id"] == uid


def test_a_cancel_stops_a_long_streamed_line():
    with Vikaki(URL) as v:
        uid = v.say("This is a long line. " * 40, seat_id="seat-1")
        v.cancel(uid)
        done = v.wait_finished(uid, timeout=30)
    assert done["type"] in ("speech_interrupted", "speech_finished")
    if done["type"] == "speech_interrupted":
        assert done["reason"] == "cancelled"


def test_a_second_driver_is_told_driver_busy():
    from vikaki_client import HubError

    with Vikaki(URL):
        with pytest.raises(HubError) as err:
            Vikaki(URL)
    assert err.value.code == "driver_busy"


def test_two_seat_drivers_speak_at_once_and_a_third_for_a_taken_seat_is_busy():
    from vikaki_client import HubError

    with Vikaki(URL, seats=[{"seat_id": "s1"}]) as a, Vikaki(URL, seats=[{"seat_id": "s2"}]) as b:
        ua = a.say("Seat one speaking.", seat_id="s1")
        ub = b.say("Seat two speaking.", seat_id="s2")
        assert a.wait_finished(ua, timeout=30)["utterance_id"] == ua
        assert b.wait_finished(ub, timeout=30)["utterance_id"] == ub
        with pytest.raises(HubError) as err:
            Vikaki(URL, seats=[{"seat_id": "s1"}])
    assert err.value.code == "driver_busy"


def test_a_humans_speech_sent_by_a_page_reaches_the_driver_of_that_seat():
    import json
    import time

    from websockets.sync.client import connect

    with Vikaki(URL, seats=[{"seat_id": "s1"}]) as a:
        heard = []
        a.on_event(heard.append)
        with connect(URL) as page:  # what an avatar page does for its host
            page.send(json.dumps({"protocol_version": 1, "type": "hello", "role": "viewer"}))
            assert json.loads(page.recv(10))["type"] == "welcome"
            page.send(json.dumps({"protocol_version": 1, "type": "human_utterance", "seat_id": "s1", "text": "Ocean", "final": True}))
            for _ in range(1000):
                if heard:
                    break
                time.sleep(0.01)
    assert heard and heard[0]["type"] == "human_utterance" and heard[0]["seat_id"] == "s1" and heard[0]["text"] == "Ocean"
