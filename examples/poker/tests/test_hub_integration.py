"""Three seats, three drivers, a real hub with the fake voice and a scripted LLM: a whole hand is spoken and each driver is told its own lines finished.

Needs `pnpm serve --port N --tts fake --personas personas.table.example.yaml` running and `VIKAKI_HUB_URL=ws://127.0.0.1:N/ws`, and `vikaki-client` installed.
CI starts the hub and sets these; locally the test is skipped without them. (No viewer is connected on purpose: a viewer is a page that must report playback.)
"""

import json
import os

import pytest

from vikaki_poker.llm import FakeLlm
from vikaki_poker.reactions import MirrorReactor
from vikaki_poker.runner import HubVoice, play_session
from vikaki_poker.seat import SeatAgent

URL = os.environ.get("VIKAKI_HUB_URL")
pytestmark = [pytest.mark.integration, pytest.mark.skipif(not URL, reason="set VIKAKI_HUB_URL to a hub started with --personas personas.table.example.yaml")]


def test_a_hand_is_spoken_by_three_drivers_on_a_real_hub():
    pytest.importorskip("vikaki_client")
    seats = {"seat-1": "ada", "seat-2": "ben", "seat-3": "cy"}
    agents = {
        seat: SeatAgent(seat, persona, FakeLlm([json.dumps({"think": f"{persona} likes this.", "action": "call", "say": f"{persona} calls.", "emotion": "happy"}), json.dumps({"action": "check", "say": f"{persona} checks."})]), "fake")
        for seat, persona in seats.items()
    }
    problems: list[str] = []
    voice = HubVoice(URL, seats, line_timeout=30, on_problem=problems.append)
    try:
        session = play_session(agents, voice, hands=1, stack=50, seed=3, out=lambda *_: None, reactor=MirrorReactor())  # the listeners react silently, through the real hub
        spoken = sum(len(r.hand.events) for r in session.results)
        heard = voice.lines_heard
    finally:
        voice.close()
    assert session.hands_played == 1 and sum(session.stacks.values()) == 150
    assert not problems  # in particular, every private thought was accepted by the hub
    assert heard >= 3 and spoken > 0  # every seat spoke at least once and the hub reported it finished
