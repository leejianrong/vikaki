# Docker

Three images are built from one `Dockerfile`:

| Image (target) | Has | Size | Use it for |
| --- | --- | --- | --- |
| `vikaki` | the avatar page, hub, speech (the fake test voice), CLI, MCP | about 560 MB (most of it the Node base image) | a hub for drivers and browsers; audio-only seats |
| `vikaki-kokoro` | the small image plus the real voice: Kokoro, its native runtime and its model | about 1.3 GB (the model is about 330 MB of it, baked in) | a game that wants speech people can listen to; no download at start |
| `vikaki-render` | the above plus Chromium and its libraries | about 1.6 GB | `vikaki stream` (the MJPEG feed) and `serve --headless` with no GPU |

```bash
make docker-build                # or: docker build --target vikaki -t vikaki .
docker run --rm -p 127.0.0.1:8787:8787 vikaki
# open http://localhost:8787/avatar, then from the host:
pnpm --silent vikaki say --port 8787 "Hello from outside the container"

docker run --rm -p 127.0.0.1:8787:8787 vikaki-render stream --host 0.0.0.0 --port 8787 --size 1280x720
ffplay http://127.0.0.1:8787/stream.mjpg
```

`vikaki serve` listens on `0.0.0.0` inside the container (the default command passes `--host 0.0.0.0 --port 8787`), so **publish the port to the host's loopback only**, as above (`127.0.0.1:8787:8787`). The hub refuses browser origins from other sites and `Host` names that are not local, but it is a control channel for your avatar and should not face a network. Add `--token <secret>` (or `-e VIKAKI_TOKEN=...`) if more than one program shares the machine.

## Configuration by environment

A container is configured through its environment, so a compose file does not have to override the command. Each variable does what its flag does, and **a flag wins** when both are given. An empty variable counts as unset; a bad value names the variable and the hub does not start.

| Variable | Flag | Value |
| --- | --- | --- |
| `VIKAKI_TTS` | `--tts` | `auto` (default), `kokoro`, `fake` or `none` |
| `VIKAKI_TOKEN` | `--token` | a secret the driver must send in `hello` |
| `VIKAKI_FRAME_ANCESTORS` | `--frame-ancestors` | comma-separated origins that may embed the avatar page, or `none` |
| `VIKAKI_PERSONAS` | `--personas` | path of a personas file, such as `/data/personas.yaml` |
| `VIKAKI_ALLOWED_HOSTS` | `--allow-host` | extra `Host` names to answer, such as `vikaki:8787` (see below) |

```bash
docker run --rm -p 127.0.0.1:8787:8787 -v $PWD:/data \
  -e VIKAKI_TOKEN=change-me -e VIKAKI_FRAME_ANCESTORS=https://game.example -e VIKAKI_PERSONAS=/data/personas.yaml vikaki
```

There is no config file ([VIK-126](https://github.com/leejianrong/vikaki)): the four variables are the whole surface a container needs. The token is never printed.

## A game beside the hub: extra Host names

The hub answers only `127.0.0.1`, `localhost` and `[::1]` as `Host`, so a web page on another site cannot reach it by pointing a DNS name at your machine (DNS rebinding). Inside a compose network a game reaches the hub as `vikaki:8787`, which that rule refuses. List the names you expect, and only those:

```yaml
services:
  vikaki:
    image: ghcr.io/leejianrong/vikaki
    environment:
      VIKAKI_ALLOWED_HOSTS: vikaki:8787
    ports: ["127.0.0.1:8787:8787"]
```

A name with a port (`vikaki:8787`) matches that port only; a bare name (`vikaki`) matches any port. No wildcards, no schemes, nothing is accepted by default, and every other name is still refused (403). The browser origin rule is separate and unchanged. The MJPEG feed of `stream` takes the same list. Listing a name opens no port to the network: publish the port to loopback only, as above, and keep the hub on a private compose network. See [ADR-0044](adr/0044-extra-host-names-are-an-explicit-list.md).

A complete, runnable wiring of a game beside the hub (a stand-in game, loopback ports, the settings above) is in [examples/compose](../examples/compose/README.md).

## What the image does

- Runs as the unprivileged user `node` (uid 1000), exposes only `8787`, and has a health check (the avatar page answers) that passes about 5 seconds after start on the development machine (the test requires under 10).
- `ENTRYPOINT` is the `vikaki` command, so `docker run vikaki say ...` and `docker run vikaki-render stream ...` work; the default `CMD` is `serve --host 0.0.0.0 --port 8787`.
- `/data` is a folder owned by the server's user for what you bring: `-v $PWD:/data` with `--personas /data/personas.yaml`, `--event-log /data/run.jsonl`, `--debug-dir /data/debug`. The example personas file is at `/app/personas.example.yaml` (an example, not a promise) and the bundled avatars are at `/app/avatars/` (a promise: [personas.md](personas.md#what-a-game-can-rely-on-vik-131)).
- The small image has no browser. `serve --headless` there says so and points to `vikaki-render`.
- Chromium in the render image runs with software WebGL (no GPU). Under CPU limits the page can freeze for most of a second at the first speech (see [observability.md](observability.md)); for a GPU, run a GPU-enabled runtime and add `--gpu`, or use audio-only pages for seats nobody needs to see ([personas.md](personas.md)).

## The real voice

`vikaki-kokoro` speaks with Kokoro ([ADR-0010](adr/0010-kokoro-for-local-tts.md): Apache-2.0, run locally on the CPU). It is the small image plus what `make install-voice` installs: `kokoro-js` with its native ONNX runtime, and the model (full precision, about 330 MB). The build loads the model and makes it speak once, so an image whose native runtime does not work in the container is never produced. The model is **in the image**, so the first start needs no network and no download: the hub is healthy in about 5 seconds and the first line comes a second or so after its text (about 0.9 s to first audio on the development machine, CPU only).

```bash
docker build --target vikaki-kokoro -t vikaki-kokoro .
docker run --rm -p 127.0.0.1:8787:8787 vikaki-kokoro        # "speech: kokoro" in its first lines; VIKAKI_TTS=auto picks it
```

Costs: the image is about 1.3 GB (the small one is about 400 MB), and speech is CPU-bound: a busy host, or a CPU limit, slows the first audio (see [observability.md](observability.md)). No GPU support. `VIKAKI_TTS=fake` still gives the test tone when you want a fast, silent-ish test run, and the voice id comes from the personas file (`voice: af_heart`) or `--voice`.

The small image still speaks only with the test tone and says so on start.

## Tests

`make docker-test` builds both images, starts containers and checks: non-root user, only the documented port, healthy within 10 seconds, the avatar page served, a driver outside the container makes it speak (and in the Kokoro image, with the real voice), a browser origin from another site is refused, the environment-variable settings, a listed Host name, a mounted personas file, the compose example (a game and the hub, brought up with `docker compose`), and (render image) a line is drawn by the hidden page with no GPU and `ffprobe` on the feed sees an MJPEG stream at the size asked for. CI runs them in `.github/workflows/docker.yml` when the image or the code it runs changes, and nightly.
