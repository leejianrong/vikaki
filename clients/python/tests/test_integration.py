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
