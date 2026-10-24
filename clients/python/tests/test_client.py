import asyncio

import pytest

from conftest import V, default_script, run
from vikaki_client import HubError, InvalidMessage, VikakiClient


def test_connect_says_hello_as_a_driver_and_keeps_the_welcome(hub):
    async def go():
        async with await VikakiClient.connect(hub.url, token="secret", session_id="m1") as c:
            assert c.welcome["speech"] == "fake" and c.welcome["personas"] == ["ada", "ben"]
            assert c.role == "driver"

    run(go())
    hello = hub.wait_received(1)[0]
    assert hello["type"] == "hello" and hello["role"] == "driver" and hello["token"] == "secret" and hello["session_id"] == "m1"
    assert hello["protocol_version"] == 1 and hello["client"].startswith("vikaki-client-python/")


def test_say_sends_the_line_and_wait_finished_returns_the_hubs_verdict(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            uid = await c.say("Pot odds are fine.", seat_id="seat-2", emotion="smug", intensity=0.7, persona="ada", kind="banter")
            done = await c.wait_finished(uid, timeout=5)
            return uid, done

    uid, done = run(go())
    sent = hub.received[1]
    assert sent == {"protocol_version": 1, "type": "utterance", "seat_id": "seat-2", "utterance_id": uid, "text": "Pot odds are fine.", "emotion": "smug", "intensity": 0.7, "persona": "ada", "kind": "banter"}
    assert done["type"] == "speech_finished" and done["utterance_id"] == uid and done["timing"]["audio_ms"] == 12


def test_a_line_can_say_who_it_is_for(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            await c.say("Nice try, Ben.", seat_id="seat-1", utterance_id="u-to", to="seat-2")

    run(go())
    assert hub.received[1]["to"] == "seat-2"


def test_a_given_utterance_id_is_used_and_an_interrupted_line_is_returned_not_raised(make_hub):
    def script(msg, h):
        if msg["type"] == "utterance":
            return [{"protocol_version": V, "type": "speech_interrupted", "utterance_id": msg["utterance_id"], "reason": "human_spoke"}]
        return default_script(msg, h)

    hub = make_hub(script)

    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            uid = await c.say("hi", seat_id="s", utterance_id="mine-1")
            return uid, await c.wait_finished(uid, timeout=5)

    uid, out = run(go())
    assert uid == "mine-1" and out["type"] == "speech_interrupted" and out["reason"] == "human_spoke"


def test_table_state_goes_out_with_only_what_was_set(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            await c.table_state([{"seat_id": "s", "stack": 50}], pot=5, turn="s")

    run(go())
    assert hub.wait_received(2)[1] == {"protocol_version": 1, "type": "table_state", "seats": [{"seat_id": "s", "stack": 50}], "pot": 5, "turn": "s"}


def test_react_goes_out_with_only_what_was_set(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            await c.react("s", gesture="shake", seconds=1)

    run(go())
    assert hub.wait_received(2)[1] == {"protocol_version": 1, "type": "react", "seat_id": "s", "gesture": "shake", "seconds": 1}


def test_a_thought_goes_out_as_text_for_a_seat(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            await c.thought("s", "Ace-king. Raise.", persona="ada")

    run(go())
    assert hub.wait_received(2)[1] == {"protocol_version": 1, "type": "thought", "seat_id": "s", "text": "Ace-king. Raise.", "persona": "ada"}


def test_a_humans_speech_for_the_seat_arrives_with_the_other_events(hub):
    async def go():
        async with await VikakiClient.connect(hub.url, seats=[{"seat_id": "s"}]) as c:
            heard = []
            c.on_event(heard.append)
            hub.push({"protocol_version": 1, "type": "human_utterance", "seat_id": "s", "text": "Ocean", "final": False})
            hub.push({"protocol_version": 1, "type": "human_utterance", "seat_id": "s", "text": "Ocean waves", "final": True})
            hub.push({"protocol_version": 1, "type": "speech_started", "utterance_id": "zz"})
            got = []
            async for e in c.events():
                got.append(e)
                if e["type"] == "speech_started":
                    break
            return heard, got

    heard, got = run(go())
    humans = [e for e in got if e["type"] == "human_utterance"]
    assert [(e["seat_id"], e["text"], e["final"]) for e in humans] == [("s", "Ocean", False), ("s", "Ocean waves", True)]
    assert [e["type"] for e in heard] == ["human_utterance", "human_utterance", "speech_started"]


def test_cancel_with_and_without_an_id(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            uid = await c.say("a long line", seat_id="s")
            await c.cancel(uid)
            await c.cancel()
            await c.turn_started("s", persona="ada")
            await c.turn_ended("s")
            await c.game_over("won", seat_id="s")
            return uid

    uid = run(go())
    got = hub.wait_received(7)[2:]
    assert got[0]["type"] == "cancel" and got[0]["utterance_id"] == uid
    assert got[1] == {"protocol_version": 1, "type": "cancel"}
    assert got[2] == {"protocol_version": 1, "type": "turn_started", "seat_id": "s", "persona": "ada"}
    assert got[3] == {"protocol_version": 1, "type": "turn_ended", "seat_id": "s"}
    assert got[4] == {"protocol_version": 1, "type": "game_over", "outcome": "won", "seat_id": "s"}


def test_a_stream_sends_each_chunk_in_order_and_marks_only_the_last_final(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            async def chunks():
                for piece in ["Hel", "", "lo, ", "world."]:
                    yield piece

            uid = await c.say_stream(chunks(), seat_id="s", emotion="happy", persona="ada")
            return uid, await c.wait_finished(uid, timeout=5)

    uid, done = run(go())
    sent = hub.wait_received(4)[1:4]
    assert [m["delta"] for m in sent] == ["Hel", "lo, ", "world."]
    assert [m["final"] for m in sent] == [False, False, True]
    assert all(m["utterance_id"] == uid and m["emotion"] == "happy" and m["persona"] == "ada" for m in sent)
    assert done["type"] == "speech_finished"


def test_a_plain_list_works_as_a_stream_and_a_stream_with_no_text_sends_nothing(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            with pytest.raises(InvalidMessage, match="no text"):
                await c.say_stream(["", ""], seat_id="s")
            uid = await c.say_stream(["only"], seat_id="s")
            await c.wait_finished(uid, timeout=5)

    run(go())
    sent = hub.wait_received(2)
    assert [m["type"] for m in sent] == ["hello", "utterance"] and sent[1]["delta"] == "only" and sent[1]["final"] is True


def test_a_message_that_breaks_the_protocol_is_refused_and_nothing_is_sent(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            with pytest.raises(InvalidMessage):
                await c.say("hi", seat_id="s", intensity=3)
            await c.cancel()  # the next thing the hub should see

    run(go())
    assert [m["type"] for m in hub.wait_received(2)] == ["hello", "cancel"]


@pytest.mark.parametrize("code", ["driver_busy", "unauthorized", "unsupported_protocol_version"])
def test_the_hub_refusing_hello_raises_hub_error_with_its_code(make_hub, code):
    hub = make_hub(lambda msg, h: [{"protocol_version": V, "type": "error", "code": code, "message": "no"}] if msg["type"] == "hello" else [])
    with pytest.raises(HubError) as err:
        run(VikakiClient.connect(hub.url))
    assert err.value.code == code and err.value.message == "no"


def test_nothing_listening_is_connect_failed_with_advice():
    with pytest.raises(HubError) as err:
        run(VikakiClient.connect("ws://127.0.0.1:1/ws", timeout=2))
    assert err.value.code == "connect_failed" and "vikaki serve" in err.value.message


def test_a_hub_that_never_answers_hello_times_out(make_hub):
    hub = make_hub(lambda msg, h: [])
    with pytest.raises(HubError) as err:
        run(VikakiClient.connect(hub.url, timeout=0.3))
    assert err.value.code == "timeout"


def test_messages_and_fields_it_does_not_know_are_ignored(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            seen = []
            c.on_event(seen.append)
            uid = await c.say("hi", seat_id="s")
            await c.wait_finished(uid, timeout=5)
            hub.push({"protocol_version": 1, "type": "from_the_future", "x": 1})
            hub.push("this is not json")
            hub.push({"no_type": True})
            hub.push({"protocol_version": 1, "type": "speech_started", "utterance_id": "zz", "new_field": [1, 2]})
            await asyncio.sleep(0)  # let the reader run; the assertion below waits on the event itself
            while not any(e.get("utterance_id") == "zz" for e in seen):
                await asyncio.sleep(0.005)
            return seen

    seen = run(go())
    assert [e["type"] for e in seen] == ["speech_started", "speech_finished", "speech_started"]
    assert seen[-1]["new_field"] == [1, 2]


def test_an_error_for_a_line_makes_wait_finished_raise_with_that_line_id(make_hub):
    def script(msg, h):
        if msg["type"] == "utterance":
            return [{"protocol_version": V, "type": "error", "code": "tts_failed", "message": "voice down", "utterance_id": msg["utterance_id"]}]
        return default_script(msg, h)

    hub = make_hub(script)

    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            uid = await c.say("hi", seat_id="s")
            with pytest.raises(HubError) as err:
                await c.wait_finished(uid, timeout=5)
            return uid, err.value

    uid, err = run(go())
    assert err.code == "tts_failed" and err.utterance_id == uid


def test_wait_finished_times_out_and_does_not_lose_the_line(make_hub):
    hub = make_hub(lambda msg, h: default_script(msg, h) if msg["type"] == "hello" else [])

    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            uid = await c.say("hi", seat_id="s")
            with pytest.raises(HubError) as err:
                await c.wait_finished(uid, timeout=0.1)
            assert err.value.code == "timeout"
            hub.push({"protocol_version": 1, "type": "speech_finished", "utterance_id": uid})
            return (await c.wait_finished(uid, timeout=5))["type"]  # asking again still works

    assert run(go()) == "speech_finished"


def test_wait_finished_for_a_line_never_sent_here_is_a_key_error(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            with pytest.raises(KeyError):
                await c.wait_finished("nope")

    run(go())


def test_the_connection_dropping_while_waiting_raises_connection_closed(make_hub):
    hub = make_hub(lambda msg, h: default_script(msg, h) if msg["type"] == "hello" else [])

    async def go():
        c = await VikakiClient.connect(hub.url)
        uid = await c.say("hi", seat_id="s")
        waiting = asyncio.ensure_future(c.wait_finished(uid, timeout=10))
        await asyncio.sleep(0)
        await asyncio.to_thread(hub.drop)
        with pytest.raises(HubError) as err:
            await waiting
        assert err.value.code == "connection_closed" and c.closed
        with pytest.raises(HubError):
            await c.say("again", seat_id="s")
        await c.close()

    run(go())


def test_events_arrive_in_order_and_the_iterator_ends_when_the_connection_closes(hub):
    async def go():
        c = await VikakiClient.connect(hub.url)
        uid = await c.say("hi", seat_id="s")
        await c.wait_finished(uid, timeout=5)
        await c.close()
        return [e["type"] async for e in c.events()]

    assert run(go()) == ["speech_started", "speech_finished"]


def test_listeners_may_be_functions_or_coroutines_and_a_broken_one_does_not_stop_the_others(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            got_sync, got_async = [], []

            def boom(_):
                raise RuntimeError("listener bug")

            async def later(e):
                got_async.append(e["type"])

            c.on_event(boom)
            c.on_event(lambda e: got_sync.append(e["type"]))
            c.on_event(later)
            uid = await c.say("hi", seat_id="s")
            await c.wait_finished(uid, timeout=5)
            return got_sync, got_async

    got_sync, got_async = run(go())
    assert got_sync == got_async == ["speech_started", "speech_finished"]


def test_a_seat_driver_lists_its_seats_in_hello_and_a_bad_list_is_refused_before_connecting(hub):
    async def go():
        async with await VikakiClient.connect(hub.url, seats=[{"seat_id": "seat-2", "persona": "ada"}, {"seat_id": "seat-3"}]):
            pass
        with pytest.raises(InvalidMessage):
            await VikakiClient.connect(hub.url, seats=[])  # no seats at all is not a list of seats

    run(go())
    assert hub.wait_received(1)[0]["seats"] == [{"seat_id": "seat-2", "persona": "ada"}, {"seat_id": "seat-3"}]


def test_table_state_carries_the_beat_the_hand_number_and_the_winners(hub):
    async def go():
        async with await VikakiClient.connect(hub.url) as c:
            await c.table_state([{"seat_id": "s", "stack": 50}], hand_no=2, event={"kind": "fold", "seat_id": "s", "text": "S folds"}, winners=[{"seat_id": "s", "amount": 5}])

    run(go())
    sent = hub.wait_received(2)[1]
    assert sent["hand_no"] == 2 and sent["event"]["text"] == "S folds" and sent["winners"] == [{"seat_id": "s", "amount": 5}]


def test_table_state_carries_the_rebuy_policy_and_an_audience_request_arrives_as_an_event(hub):
    async def go():
        async with await VikakiClient.connect(hub.url, seats=[{"seat_id": "s"}]) as c:
            await c.table_state([{"seat_id": "s", "stack": 0}], rebuy="ask")
            hub.push({"protocol_version": 1, "type": "audience_request", "kind": "rebuy", "seat_id": "s"})
            async for e in c.events():
                return e

    event = run(go())
    assert hub.wait_received(2)[1]["rebuy"] == "ask"
    assert event == {"protocol_version": 1, "type": "audience_request", "kind": "rebuy", "seat_id": "s"}
