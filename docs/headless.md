# Headless rendering

`vikaki serve --headless` opens the avatar page in a hidden Chromium, one tab per persona, connected to the hub like any browser. Lines are **rendered for real** with no one at a screen, so the driver hears timings measured on a page that drew frames (`speech_finished.timing.frame_ms` exists only when something was drawn). It is for CI, unattended runs, and the feed that `vikaki stream` publishes.

```bash
make install-renderer                 # once: Playwright's Chromium, about 170 MB
pnpm serve --tts fake --headless      # one hidden page that shows every line
pnpm serve --personas personas.example.yaml --headless   # one hidden page per persona
pnpm serve --headless --audio-only    # hidden audio-only pages: heard, nothing drawn (see personas.md)
```

`make doctor` says whether a browser is found. The browser is an optional install, like the voice ([ADR-0010](adr/0010-kokoro-for-local-tts.md)): the base install stays small, and `--headless` without it exits with the exact fix. To use a Chrome or Chromium you already have, set `VIKAKI_CHROME=/path/to/chrome` or pass `--chrome <path>`; a path that does not exist is an error, not a silent fallback.

## Software WebGL

With no GPU (CI, most containers) Chromium draws with software WebGL (SwiftShader), which the e2e suite already uses. On this development machine the page runs at the display's 60 fps at 1280 by 720. Under CPU limits it can freeze for most of a second when the first speech starts (see the "first-speech freeze" note in [observability.md](observability.md)); a real GPU removes that. `--gpu` leaves the software flags off so Chromium uses the machine's GPU where there is one. If software rendering is too slow in your container, run with `--gpu` and a GPU-enabled runtime, or use `--audio-only` pages for seats nobody needs to see.

## What it does and does not do

- It opens pages with `?live=1&hud=0` (and `&persona=<name>`, `&render=off` for audio-only). Sound plays into nothing (`--mute-audio`); the page's audio clock still runs, so timings are real.
- Ctrl+C stops the browser first, then the server, and exits 0. Playwright's own Ctrl+C handler is turned off so it cannot exit 130 first.
- It does not capture video. `vikaki stream` (V4.4) turns the same pages into an MJPEG feed.
