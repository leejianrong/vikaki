"""A stand-in game for the compose example: serves a page with the avatars framed in it, and speaks a line for each seat every few seconds.

It shows the three things a real game does: serve its own page around the framed avatar page, drive the hub as a game server
(a token, a Host the hub was told to accept), and read how each line went.
"""

import asyncio
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from vikaki_client import VikakiClient

HUB_WS = os.environ.get("VIKAKI_URL", "ws://vikaki:8787/ws")
TOKEN = os.environ.get("VIKAKI_TOKEN")
HUB_URL = os.environ.get("PUBLIC_HUB_URL", "http://127.0.0.1:8787")
GAME_URL = os.environ.get("PUBLIC_GAME_URL", "http://127.0.0.1:8765")
EVERY = float(os.environ.get("GAME_SECONDS_BETWEEN_LINES", "12"))

LINES = [("seat-1", "ada", "Your move. I will wait."), ("seat-2", "ben", "Hmm. That is a good clue."), ("seat-1", "ada", "I think I know this one.")]

started = threading.Event()  # set once a line has been heard to finish: what the health check and the test wait for


def page() -> bytes:
    # The hub's page, framed: `parent` is this page's origin (it must be in the hub's VIKAKI_FRAME_ANCESTORS).
    src = f"{HUB_URL}/avatar?seats=ada,ben&embed=1&names=1&captions=1&parent={GAME_URL}"
    return f"""<!doctype html><meta charset="utf-8"><title>Stand-in game</title>
<body style="font-family:sans-serif;margin:2rem"><h1>Stand-in game</h1>
<p>Your game draws here. The avatars are the hub's page, framed.</p>
<iframe id="avatar" src="{src}" allow="autoplay" style="border:0;width:100%;height:420px"></iframe>
<p><button id="start">Start sound</button></p>
<script>
  const frame = document.getElementById("avatar");
  document.getElementById("start").onclick = () => frame.contentWindow.postMessage({{ type: "unlock" }}, "{HUB_URL}");
</script></body>""".encode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/healthz":
            body, kind = (b"ok", "text/plain") if started.is_set() else (b"not yet", "text/plain")
            self.send_response(200 if started.is_set() else 503)
        else:
            body, kind = page(), "text/html; charset=utf-8"
            self.send_response(200)
        self.send_header("content-type", kind)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        pass


async def play() -> None:
    async with await VikakiClient.connect(HUB_WS, token=TOKEN) as hub:
        print(f"game: connected to {HUB_WS}", flush=True)
        n = 0
        while True:
            seat, persona, text = LINES[n % len(LINES)]
            n += 1
            await hub.turn_started(seat, persona=persona)
            uid = await hub.say(text, seat_id=seat, persona=persona)
            done = await hub.wait_finished(uid, timeout=60)
            print(f"game: {persona} said {text!r}: {done['type']}", flush=True)
            if done["type"] == "speech_finished":
                started.set()
            await hub.turn_ended(seat, persona=persona)
            await asyncio.sleep(EVERY)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8765), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"game: page on {GAME_URL}", flush=True)
    asyncio.run(play())
