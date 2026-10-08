# Docker

Two images are built from one `Dockerfile`:

| Image (target) | Has | Size | Use it for |
| --- | --- | --- | --- |
| `vikaki` | the avatar page, hub, speech (the fake test voice), CLI, MCP | about 560 MB (most of it the Node base image) | a hub for drivers and browsers; audio-only seats |
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

## What the image does

- Runs as the unprivileged user `node` (uid 1000), exposes only `8787`, and has a health check (the avatar page answers) that passes about 5 seconds after start on the development machine (the test requires under 10).
- `ENTRYPOINT` is the `vikaki` command, so `docker run vikaki say ...` and `docker run vikaki-render stream ...` work; the default `CMD` is `serve --host 0.0.0.0 --port 8787`.
- `/data` is a folder owned by the server's user for what you bring: `-v $PWD:/data` with `--personas /data/personas.yaml`, `--event-log /data/run.jsonl`, `--debug-dir /data/debug`. The example personas file and its avatars are at `/app/personas.example.yaml`.
- The small image has no browser. `serve --headless` there says so and points to `vikaki-render`.
- Chromium in the render image runs with software WebGL (no GPU). Under CPU limits the page can freeze for most of a second at the first speech (see [observability.md](observability.md)); for a GPU, run a GPU-enabled runtime and add `--gpu`, or use audio-only pages for seats nobody needs to see ([personas.md](personas.md)).

## Not in the image

**The real voice.** Kokoro is about 410 MB with its runtime and is an optional install ([ADR-0010](adr/0010-kokoro-for-local-tts.md)), so the images speak with the steady "aah" test tone and say so on start. Packaging the real voice (and checking that its native runtime works in the image) is not done; run the voice on the host or extend the image yourself.

## Tests

`make docker-test` builds both images, starts containers and checks: non-root user, only the documented port, healthy within 10 seconds, the avatar page served, a driver outside the container makes it speak, a browser origin from another site is refused, and (render image) a line is drawn by the hidden page with no GPU and `ffprobe` on the feed sees an MJPEG stream at the size asked for. CI runs them in `.github/workflows/docker.yml` when the image or the code it runs changes, and nightly.
