# The video feed: `vikaki stream`

`vikaki stream` renders the avatar in a hidden browser ([headless.md](headless.md)) and publishes it as an **MJPEG** video feed over HTTP, the simplest video other programs can open. It takes every `vikaki serve` option (voice, personas, token, event log) and adds the picture options.

```bash
make install-renderer                       # once: the browser, about 170 MB
pnpm --silent vikaki stream --port 8787     # prints: stream: http://127.0.0.1:8787/stream.mjpg (1280x720, 15 fps)
ffplay http://127.0.0.1:8787/stream.mjpg    # or VLC: Media > Open Network Stream
pnpm --silent vikaki say --port 8787 "Good morning everyone."   # the avatar in the feed speaks
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--size WxH` | `1280x720` | Pixels. The page is rendered at this size, so it is also the framing. |
| `--fps N` | `15` | Frames per second sent to each viewer (1 to 60). The latest frame is repeated if nothing new has been drawn, so players never stall. |
| `--quality N` | `80` | JPEG quality (1 to 100). About 24 KB per frame at 1280 by 720, so about 360 KB/s at 15 fps. |
| `--background` | `fff1e8` | A solid colour as 6 hex digits, or `green` (`00b140`) for chroma keying. Video cannot be transparent. |
| `--stream-persona NAME` | the first persona | Which persona's page to publish, when a personas file gives several. All personas are still rendered. |

## Endpoints

- `/stream.mjpg`: the endless feed (`multipart/x-mixed-replace`). Works in VLC, ffplay, an `<img>` in a browser, and OBS (Media Source, untick "local file", paste the URL).
- `/stream.jpg`: the latest frame as one JPEG (`503` until the first frame exists), handy for a thumbnail or a health check.

## Access

The feed answers only local `Host` names (so a web page cannot reach it through DNS rebinding) and listens on localhost. With `--token <secret>` (or `VIKAKI_TOKEN`) a viewer must add `?token=<secret>` to either URL; without it they get `401`. A viewer too slow for the feed has frames skipped rather than queued, so one slow player never holds memory or delays the others.

## Measured

On the development machine (WSL2, software WebGL, no GPU) a 1280 by 720 feed at 15 fps delivered 89 frames in 6 seconds, as asked. Software rendering can freeze the page for most of a second when the first speech starts (see [observability.md](observability.md)); `--gpu` helps where a GPU exists.

## Not done

A virtual-camera output (v4l2loopback on Linux) was an optional extra on the roadmap and is not built. OBS can use the feed as a Media Source; the meeting extension ([packages/extension](../packages/extension/README.md)) remains the way to appear as a camera in a browser meeting.
