# vikaki-client

A small Python client for the Vikaki avatar hub, so a game or script can make an avatar speak without writing the WebSocket handshake, the id bookkeeping and the error cases itself. Decision and scope: [ADR-0016](../../docs/adr/0016-python-client-for-the-games-presenter.md). Wire format: [docs/protocol.md](../../docs/protocol.md).

It connects to a running `vikaki serve`; it does not start the hub, speak, or draw anything.

## Install

From this repo's git URL (it is not on PyPI yet):

```bash
pip install "git+https://github.com/leejianrong/vikaki.git#subdirectory=clients/python"
```

Python 3.10 or newer. Dependencies: `websockets` (BSD-3-Clause) and `jsonschema` (MIT).

## Use

```python
from vikaki_client import Vikaki

with Vikaki("ws://127.0.0.1:8787/ws") as v:          # a driver; add token="..." if the hub has one
    v.turn_started("seat-1")                          # the avatar looks thoughtful
    uid = v.say("Pot odds say I call.", seat_id="seat-1", emotion="smug", persona="ada")
    v.wait_finished(uid, timeout=30)                  # speech_finished, or speech_interrupted
    v.game_over("won", seat_id="seat-1")
```

Start a hub first: `pnpm serve --port 8787 --tts fake` (or `--tts kokoro` for the real voice).

An LLM's output can be spoken while it is still being written; each chunk is sent as it arrives and the first sentence is spoken before the rest is known:

```python
uid = v.say_stream(token_iterator, seat_id="seat-1")
```

`cancel()` stops everything speaking; `cancel(uid)` stops one line.

A human's speech, as text, comes back with the other events (the host page's recogniser sends it through the avatar page, [ADR-0024](../../docs/adr/0024-a-humans-speech-is-text-from-the-page-to-the-seats-driver.md)): `{"type": "human_utterance", "seat_id": "seat-1", "text": "ocean waves", "final": True}`, with `final` false while it is still being recognised. A seat driver hears only its own seat's.

```python
v.on_event(lambda e: e["type"] == "human_utterance" and e.get("final", True) and handle(e["seat_id"], e["text"]))
```

### At a table of several seats

One client per LLM, each bound to its seat ([ADR-0017](../../docs/adr/0017-one-driver-per-seat.md)):

```python
v = Vikaki("ws://127.0.0.1:8787/ws", seats=[{"seat_id": "seat-2", "persona": "ben"}])
v.say("I check.", seat_id="seat-2")      # the hub fills in ben, so a line needs only its seat
```

It may speak only for its seats and hears back only about its own lines; a second client for the same seat gets `driver_busy`. Watch the table at `/avatar?seats=3`. `make demo-table` and `make table-hand` show it with no LLM.

### Async

```python
from vikaki_client import VikakiClient

async with await VikakiClient.connect("ws://127.0.0.1:8787/ws") as c:
    uid = await c.say("Hello", seat_id="seat-1")
    async for event in c.events():                    # speech_started, speech_finished, speech_interrupted, error
        ...
```

`c.on_event(callback)` takes a function or a coroutine function. In the blocking `Vikaki` the callback runs on the client's own thread, so keep it short.

### Errors

- `HubError` has a `code`: the protocol's (`driver_busy`, `unauthorized`, `unsupported_protocol_version`, `tts_failed`, ...) or `connect_failed`, `timeout`, `connection_closed`. `wait_finished` raises it when the hub reports an error for that line.
- `InvalidMessage` is raised before anything is sent, when a message breaks the protocol: it is checked against the JSON Schema plus the two rules the schema cannot say (exactly one of `text` or `delta`; `final` only with `delta`).

Messages and fields this client does not know are ignored, so it keeps working against a newer hub (the protocol only grows by adding, and `protocol_version` stays 1).

## Develop

```bash
make check-python        # from the repo root; needs uv. Fake hub, no Node, no network at run time
```

To try it against a real hub: `pnpm build && pnpm serve --port 8787 --tts fake`, then `VIKAKI_HUB_URL=ws://127.0.0.1:8787/ws pytest -m integration` in this folder. CI does both.

`src/vikaki_client/protocol.schema.json` is generated: `pnpm --filter @vikaki/protocol schema` rewrites it with `docs/protocol.schema.json`, and a test fails if they differ.
