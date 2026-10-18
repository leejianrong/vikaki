"""A blocking client for code that is not async (a game loop, a `Presenter`): the same calls, run on a background thread."""

from __future__ import annotations

import asyncio
import threading
from typing import Any, AsyncIterable, Coroutine, Iterable, TypeVar

from .client import CLIENT_NAME, DEFAULT_URL, Event, Listener, VikakiClient

T = TypeVar("T")


class Vikaki:
    """`VikakiClient` with ordinary blocking methods. Each call returns when the hub has been sent the message (or, for
    `wait_finished`, when the line is over). Listeners given to `on_event` run on the client's own thread, so keep them short.

    >>> with Vikaki() as v:                                   # doctest: +SKIP
    ...     uid = v.say("Hello there", seat_id="seat-1", emotion="happy")
    ...     v.wait_finished(uid, timeout=30)
    """

    def __init__(
        self,
        url: str = DEFAULT_URL,
        *,
        role: str = "driver",
        token: str | None = None,
        client: str = CLIENT_NAME,
        session_id: str | None = None,
        seats: list[dict[str, str]] | None = None,
        timeout: float = 5.0,
    ) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, name="vikaki-client", daemon=True)
        self._thread.start()
        try:
            self._client: VikakiClient = self._run(VikakiClient.connect(url, role=role, token=token, client=client, session_id=session_id, seats=seats, timeout=timeout))
        except BaseException:
            self._stop()
            raise

    def _run(self, coro: Coroutine[Any, Any, T]) -> T:
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result()

    def _stop(self) -> None:
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5)
        if not self._thread.is_alive():
            self._loop.close()

    @property
    def welcome(self) -> Event:
        return self._client.welcome

    @property
    def closed(self) -> bool:
        return self._client.closed

    def say(self, text: str, **kw: Any) -> str:
        """See `VikakiClient.say`."""
        return self._run(self._client.say(text, **kw))

    def say_stream(self, deltas: "AsyncIterable[str] | Iterable[str]", **kw: Any) -> str:
        """See `VikakiClient.say_stream`. `deltas` is read on the client's thread."""
        return self._run(self._client.say_stream(deltas, **kw))

    def cancel(self, utterance_id: str | None = None) -> None:
        self._run(self._client.cancel(utterance_id))

    def turn_started(self, seat_id: str, *, persona: str | None = None) -> None:
        self._run(self._client.turn_started(seat_id, persona=persona))

    def turn_ended(self, seat_id: str, *, persona: str | None = None) -> None:
        self._run(self._client.turn_ended(seat_id, persona=persona))

    def game_over(self, outcome: str, *, seat_id: str | None = None) -> None:
        self._run(self._client.game_over(outcome, seat_id=seat_id))

    def react(self, seat_id: str, **kw: Any) -> None:
        """See `VikakiClient.react`."""
        self._run(self._client.react(seat_id, **kw))

    def thought(self, seat_id: str, text: str, **kw: Any) -> None:
        """See `VikakiClient.thought`."""
        self._run(self._client.thought(seat_id, text, **kw))

    def table_state(self, seats: list[dict[str, Any]], **kw: Any) -> None:
        """See `VikakiClient.table_state`."""
        self._run(self._client.table_state(seats, **kw))

    def wait_finished(self, utterance_id: str, *, timeout: float | None = None) -> Event:
        return self._run(self._client.wait_finished(utterance_id, timeout=timeout))

    def on_event(self, listener: Listener) -> None:
        self._client.on_event(listener)

    def close(self) -> None:
        """Close the connection and stop the thread. Safe to call twice."""
        if self._thread.is_alive():
            try:
                self._run(self._client.close())
            finally:
                self._stop()

    def __enter__(self) -> Vikaki:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
