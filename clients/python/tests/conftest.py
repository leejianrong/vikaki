"""A fake hub: a plain WebSocket server on its own thread that records what it receives and answers like the real one, so the
tests never need Node, a voice or a network."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Any, Callable

import pytest
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

V = 1
Script = Callable[[dict[str, Any], "FakeHub"], list[dict[str, Any]]]


def default_script(msg: dict[str, Any], hub: "FakeHub") -> list[dict[str, Any]]:
    """hello gets welcome; a whole line (or the last delta) is started and finished; cancel interrupts the line named."""
    t = msg.get("type")
    if t == "hello":
        return [{"protocol_version": V, "type": "welcome", "role": msg["role"], "speech": "fake", "personas": ["ada", "ben"]}]
    if t == "utterance":
        uid = msg["utterance_id"]
        out: list[dict[str, Any]] = []
        if "text" in msg or msg.get("final") is True:
            out.append({"protocol_version": V, "type": "speech_started", "utterance_id": uid, "seat_id": msg["seat_id"]})
            out.append({"protocol_version": V, "type": "speech_finished", "utterance_id": uid, "timing": {"audio_ms": 12}})
        return out
    if t == "cancel" and msg.get("utterance_id"):
        return [{"protocol_version": V, "type": "speech_interrupted", "utterance_id": msg["utterance_id"], "reason": "cancelled"}]
    return []


class FakeHub:
    def __init__(self, script: Script = default_script) -> None:
        self.script = script
        self.received: list[dict[str, Any]] = []
        self._conns: list[ServerConnection] = []
        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._main, daemon=True)
        self._thread.start()
        assert self._ready.wait(10), "the fake hub did not start"

    def _main(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._serve())

    async def _serve(self) -> None:
        async def handler(ws: ServerConnection) -> None:
            self._conns.append(ws)
            try:
                async for raw in ws:
                    msg = json.loads(raw)
                    self.received.append(msg)
                    for reply in self.script(msg, self):
                        try:
                            await ws.send(json.dumps(reply))
                        except ConnectionClosed:
                            break  # the client has gone; keep reading so what it sent before leaving is still recorded
            finally:
                if ws in self._conns:
                    self._conns.remove(ws)

        async with serve(handler, "127.0.0.1", 0) as server:
            self.port = server.sockets[0].getsockname()[1]
            self._stop = asyncio.Event()
            self._ready.set()
            await self._stop.wait()

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/ws"

    def push(self, message: dict[str, Any] | str) -> None:
        """Send something to the connected client now. A string is sent as is (to try bad JSON)."""
        data = message if isinstance(message, str) else json.dumps(message)

        async def go() -> None:
            for ws in list(self._conns):
                await ws.send(data)

        asyncio.run_coroutine_threadsafe(go(), self._loop).result(10)

    def drop(self) -> None:
        """Close the connection from the hub's side."""

        async def go() -> None:
            for ws in list(self._conns):
                await ws.close()

        asyncio.run_coroutine_threadsafe(go(), self._loop).result(10)

    def wait_received(self, count: int, timeout: float = 10.0) -> list[dict[str, Any]]:
        """Wait (up to `timeout`) until `count` messages have arrived, then return them all."""
        deadline = time.monotonic() + timeout
        while len(self.received) < count and time.monotonic() < deadline:
            time.sleep(0.005)
        assert len(self.received) >= count, f"expected {count} messages, got {self.received}"
        return list(self.received)

    def close(self) -> None:
        self._loop.call_soon_threadsafe(self._stop.set)
        self._thread.join(timeout=5)


@pytest.fixture
def hub():
    h = FakeHub()
    yield h
    h.close()


@pytest.fixture
def make_hub():
    made: list[FakeHub] = []

    def build(script: Script = default_script) -> FakeHub:
        h = FakeHub(script)
        made.append(h)
        return h

    yield build
    for h in made:
        h.close()


def run(coro: Any) -> Any:
    """Run a coroutine to the end on a fresh event loop (the tests are plain functions, so no async plugin is needed)."""
    return asyncio.run(asyncio.wait_for(coro, 30))
