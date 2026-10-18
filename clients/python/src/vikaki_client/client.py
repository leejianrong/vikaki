"""The async client: connect to a running `vikaki serve` as a driver (or controller), speak, cancel, and hear how it went."""

from __future__ import annotations

import asyncio
import collections
import inspect
import json
import logging
import uuid
from typing import Any, AsyncIterable, AsyncIterator, Awaitable, Callable, Iterable

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, WebSocketException

from .errors import HubError, InvalidMessage
from .messages import make

log = logging.getLogger("vikaki_client")

DEFAULT_URL = "ws://127.0.0.1:8787/ws"
CLIENT_NAME = "vikaki-client-python/0.1"
_EVENT_BACKLOG = 1000
_OUTCOME_BACKLOG = 1000

Event = dict[str, Any]
Listener = Callable[[Event], "Awaitable[None] | None"]


class VikakiClient:
    """One connection to the hub.

    Use `await VikakiClient.connect(...)`, then `say`, `cancel`, `turn_started`, `turn_ended`, `game_over`, and
    `wait_finished` / `events()` for what comes back. Messages the hub sends that this client does not know are ignored
    (the protocol only grows by adding things, ADR-0001), so an older client keeps working with a newer hub.
    """

    def __init__(self, ws: ClientConnection, welcome: Event, role: str, session_id: str | None) -> None:
        self._ws = ws
        self.welcome = welcome
        self.role = role
        self._session_id = session_id
        self._outcomes: collections.OrderedDict[str, asyncio.Future[Event]] = collections.OrderedDict()
        self._events: collections.deque[Event | None] = collections.deque(maxlen=_EVENT_BACKLOG + 1)
        self._events_ready = asyncio.Event()
        self._listeners: list[Listener] = []
        self._closed = asyncio.Event()
        self._reader = asyncio.get_running_loop().create_task(self._read())

    # ---- connecting ----

    @classmethod
    async def connect(
        cls,
        url: str = DEFAULT_URL,
        *,
        role: str = "driver",
        token: str | None = None,
        client: str = CLIENT_NAME,
        session_id: str | None = None,
        seats: list[dict[str, str]] | None = None,
        timeout: float = 5.0,
    ) -> VikakiClient:
        """Open the connection and say hello. Raises `HubError` (`connect_failed`, `driver_busy`, `unauthorized`, ...).

        `seats` is for one seat's driver at a table of several (an LLM seat), each item `{"seat_id": "seat-2", "persona": "ada"}`
        (`persona` optional). Such a driver may speak only for its seats and hears back only about its own lines; the hub fills in
        the seat's persona. Leave it out to drive the whole table.
        """
        hello = make("hello", role=role, token=token, client=client, session_id=session_id, seats=seats)
        try:
            ws = await asyncio.wait_for(connect(url, max_size=2**20), timeout)
        except (OSError, WebSocketException, asyncio.TimeoutError) as err:
            raise HubError("connect_failed", f"cannot reach {url} ({err or type(err).__name__}). Is `vikaki serve` running, and on this port?") from err
        try:
            await ws.send(json.dumps(hello))
            raw = await asyncio.wait_for(ws.recv(), timeout)
            first = json.loads(raw)
        except asyncio.TimeoutError as err:
            await ws.close()
            raise HubError("timeout", "the hub did not answer hello") from err
        except (ConnectionClosed, ValueError) as err:
            await ws.close()
            raise HubError("connection_closed", "the hub closed the connection during hello") from err
        if isinstance(first, dict) and first.get("type") == "error":
            await ws.close()
            raise HubError(str(first.get("code", "internal")), str(first.get("message", "")))
        if not isinstance(first, dict) or first.get("type") != "welcome":
            await ws.close()
            raise HubError("bad_message", "the hub's first message was not welcome")
        return cls(ws, first, role, session_id)

    async def __aenter__(self) -> VikakiClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the connection. Anything still waiting gets `HubError("connection_closed")`."""
        try:
            await self._ws.close()
        finally:
            await self._reader

    @property
    def closed(self) -> bool:
        return self._closed.is_set()

    # ---- sending ----

    async def say(
        self,
        text: str,
        *,
        seat_id: str,
        utterance_id: str | None = None,
        emotion: str | None = None,
        intensity: float | None = None,
        persona: str | None = None,
        kind: str | None = None,
    ) -> str:
        """Speak one whole line. Returns its `utterance_id` (made up if you gave none), to pass to `wait_finished` or `cancel`."""
        uid = utterance_id or _new_id()
        message = make("utterance", seat_id=seat_id, utterance_id=uid, text=text, emotion=emotion, intensity=intensity, persona=persona, kind=kind)
        self._track(uid)
        await self._send(message)
        return uid

    async def say_stream(
        self,
        deltas: "AsyncIterable[str] | Iterable[str]",
        *,
        seat_id: str,
        utterance_id: str | None = None,
        emotion: str | None = None,
        intensity: float | None = None,
        persona: str | None = None,
        kind: str | None = None,
    ) -> str:
        """Speak a line still being written (an LLM's output). Each chunk is sent as it arrives; the last carries `final`.

        The hub starts speaking the first sentence while later chunks are still coming. Empty chunks are skipped. A stream with
        no text at all raises `InvalidMessage` and sends nothing.
        """
        uid = utterance_id or _new_id()
        meta = {"seat_id": seat_id, "utterance_id": uid, "emotion": emotion, "intensity": intensity, "persona": persona, "kind": kind}
        held: str | None = None
        sent = False
        async for chunk in _aiter(deltas):
            if not chunk:
                continue
            if held is not None:
                await self._send_delta(held, False, meta, track=not sent)
                sent = True
            held = chunk
        if held is None:
            raise InvalidMessage("invalid utterance: the stream had no text")
        await self._send_delta(held, True, meta, track=not sent)
        return uid

    async def _send_delta(self, delta: str, final: bool, meta: dict[str, Any], *, track: bool) -> None:
        message = make("utterance", delta=delta, final=final, **meta)
        if track:
            self._track(meta["utterance_id"])
        await self._send(message)

    async def cancel(self, utterance_id: str | None = None) -> None:
        """Stop that line now, or with no id everything speaking or queued. (A `controller` connection may send only this.)"""
        await self._send(make("cancel", utterance_id=utterance_id))

    async def turn_started(self, seat_id: str, *, persona: str | None = None) -> None:
        """The seat is thinking: its avatar looks thoughtful until a line starts or `turn_ended`."""
        await self._send(make("turn_started", seat_id=seat_id, persona=persona))

    async def turn_ended(self, seat_id: str, *, persona: str | None = None) -> None:
        await self._send(make("turn_ended", seat_id=seat_id, persona=persona))

    async def game_over(self, outcome: str, *, seat_id: str | None = None) -> None:
        """`outcome` is `won`, `lost` or `drew`."""
        await self._send(make("game_over", outcome=outcome, seat_id=seat_id))

    async def react(
        self,
        seat_id: str,
        *,
        emotion: str | None = None,
        gesture: str | None = None,
        intensity: float | None = None,
        seconds: float | None = None,
        persona: str | None = None,
    ) -> None:
        """A silent reaction: the seat shows `emotion` for `seconds` (default 1.5) and perhaps a `gesture` (`nod`, `shake` or `tilt`).

        Nothing is spoken and nothing waits in the speech queue. Send `emotion`, `gesture` or both. It is ignored while that seat is speaking
        or thinking. A seat driver may react only for its own seats.
        """
        await self._send(make("react", seat_id=seat_id, emotion=emotion, gesture=gesture, intensity=intensity, seconds=seconds, persona=persona))

    async def thought(self, seat_id: str, text: str, *, persona: str | None = None) -> None:
        """A private thought of a seat, for the people watching: shown as text, never spoken, and never sent to another driver.

        A seat driver may send it only for its own seats.
        """
        await self._send(make("thought", seat_id=seat_id, text=text, persona=persona))

    async def table_state(
        self,
        seats: list[dict[str, Any]],
        *,
        pot: float | None = None,
        street: str | None = None,
        board: list[str] | None = None,
        dealer: str | None = None,
        turn: str | None = None,
        hand_no: int | None = None,
        event: dict[str, Any] | None = None,
        winners: list[dict[str, Any]] | None = None,
    ) -> None:
        """The state of the table, for the table page's overlay. Send the whole state each time it changes.

        Each seat is `{"seat_id": ..., "stack": ...}` with optional `bet`, `folded` and `cards`. Cards are the game's short names
        (`"As"`, `"Td"`) or `"back"` for one face down, and are shown as sent. Any driver may send it; the last one wins.

        `event` is the beat that has just been played, for the page to animate and caption: `{"kind": "raise", "seat_id": "s1", "amount": 12, "text": "Ada raises to 12"}`.
        `hand_no` says which hand this is, and `winners` (`{"seat_id", "amount", "hand"?}`) who took the pot once it is paid.
        """
        await self._send(make("table_state", seats=seats, pot=pot, street=street, board=board, dealer=dealer, turn=turn, hand_no=hand_no, event=event, winners=winners))

    async def _send(self, message: Event) -> None:
        try:
            await self._ws.send(json.dumps(message))
        except ConnectionClosed as err:
            raise HubError("connection_closed", "the connection to the hub is closed") from err

    # ---- hearing back ----

    async def wait_finished(self, utterance_id: str, *, timeout: float | None = None) -> Event:
        """Wait until the line is over and return the hub's `speech_finished` or `speech_interrupted` message.

        Raises `HubError` if the hub reported an `error` for that line, if the connection closed first (`connection_closed`),
        or if `timeout` seconds passed (`timeout`). Only lines sent with `say` / `say_stream` on this connection are tracked.
        """
        fut = self._outcomes.get(utterance_id)
        if fut is None:
            raise KeyError(f"{utterance_id!r} was not sent on this connection")
        try:
            result = await asyncio.wait_for(asyncio.shield(fut), timeout)
        except asyncio.TimeoutError as err:
            raise HubError("timeout", f"line {utterance_id} did not finish in {timeout} s", utterance_id) from err
        self._outcomes.pop(utterance_id, None)
        if result.get("type") == "error":
            raise HubError(str(result.get("code", "internal")), str(result.get("message", "")), utterance_id)
        return result

    async def events(self) -> AsyncIterator[Event]:
        """Every message from the hub after `welcome` (`speech_started`, `speech_finished`, `speech_interrupted`, `error`), in order.

        Ends when the connection closes. The last 1000 not yet read are kept; older ones are dropped.
        """
        while True:
            while self._events:
                event = self._events.popleft()
                if event is None:
                    return
                yield event
            self._events_ready.clear()
            await self._events_ready.wait()

    def on_event(self, listener: Listener) -> None:
        """Call `listener(event)` for every message from the hub (a plain function or a coroutine function)."""
        self._listeners.append(listener)

    # ---- the reader ----

    def _track(self, uid: str) -> None:
        loop = asyncio.get_running_loop()
        self._outcomes[uid] = loop.create_future()
        while len(self._outcomes) > _OUTCOME_BACKLOG:
            self._outcomes.popitem(last=False)

    async def _read(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(message, dict) and isinstance(message.get("type"), str):
                    await self._dispatch(message)
        except ConnectionClosed:
            pass
        finally:
            self._closed.set()
            err = HubError("connection_closed", "the connection to the hub closed")
            for fut in self._outcomes.values():
                if not fut.done():
                    fut.set_exception(err)
                    fut.exception()  # mark as retrieved: nobody may be waiting
            self._events.append(None)
            self._events_ready.set()

    async def _dispatch(self, message: Event) -> None:
        kind = message["type"]
        uid = message.get("utterance_id")
        if kind in ("speech_finished", "speech_interrupted", "error") and isinstance(uid, str):
            fut = self._outcomes.get(uid)
            if fut is not None and not fut.done():
                fut.set_result(message)
        if kind in ("speech_started", "speech_finished", "speech_interrupted", "error"):
            self._events.append(message)
            self._events_ready.set()
            for listener in list(self._listeners):
                try:
                    result = listener(message)
                    if inspect.isawaitable(result):
                        await result
                except Exception:  # a listener's bug must not stop the reader
                    log.exception("vikaki_client: an event listener raised")


def _new_id() -> str:
    return f"utt-{uuid.uuid4().hex[:12]}"


async def _aiter(source: "AsyncIterable[str] | Iterable[str]") -> AsyncIterator[str]:
    if hasattr(source, "__aiter__"):
        async for item in source:  # type: ignore[union-attr]
            yield item
    else:
        for item in source:  # type: ignore[union-attr]
            yield item
