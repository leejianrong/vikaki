# A game and the hub, in containers

`docker-compose.yml` runs two services: `vikaki` (the hub and the avatar page, from the repo's image) and `game`, a stand-in for your own game. The stand-in serves a page with the avatars framed in it and, as a game server, makes the two characters speak every few seconds. It is the wiring, not a game.

```bash
cd examples/compose
docker compose up --build        # builds both images; the first time takes a few minutes
# open http://127.0.0.1:8765, press Start sound (the test voice is a steady tone)
docker compose down
```

What to copy into your own compose file (the comments in the file say why):

| Setting | Why |
| --- | --- |
| `ports: 127.0.0.1:8787:8787` | The hub is a control channel for your avatars: publish it to loopback only. |
| `VIKAKI_FRAME_ANCESTORS` | The origin of the page that frames the avatars, exactly as the browser shows it. |
| `VIKAKI_ALLOWED_HOSTS: vikaki:8787` | Your game server reaches the hub as `vikaki:8787`; the hub refuses Host names it was not told about. |
| `VIKAKI_PERSONAS` and a volume on `/data` | Your characters; the bundled avatars are at `/app/avatars/` ([personas.md](../../docs/personas.md)). |
| `VIKAKI_TOKEN` | A driver must send it. Take it from your environment or a secret; the one in this file is an example. |
| `VIKAKI_TTS` | `fake` is the test tone; the real voice is a separate step ([docker.md](../../docs/docker.md)). |

Ports are `VIKAKI_PORT` (8787) and `GAME_PORT` (8765); set them in the environment or a `.env` file if either is taken. Your game server does not need an `Origin` (it is not a browser) and uses `vikaki-client` with the token; the page your player sees is the one your game serves, with `<iframe src="http://127.0.0.1:8787/avatar?...&parent=<your origin>" allow="autoplay">` ([embed.md](../../docs/embed.md)).

A test (`make docker-test`) brings this file up on free ports and checks that the game's line was spoken through the hub, that the framed page is served for the game's origin and refused for another, and that the hub still refuses an unlisted Host.
