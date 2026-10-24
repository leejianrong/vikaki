# ADR-0044: Extra Host names are an explicit list; the container is configured by its environment

- Status: Accepted (VIK-126, VIK-127)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

The Wavelength team wants to run a released Vikaki image beside their game. Two things stood in the way: every setting was a command-line flag (a compose file had to override the image's command), and the hub refuses any `Host` header that is not `127.0.0.1`, `localhost` or `[::1]` (the defence against DNS rebinding), so a game on a compose network, which reaches the hub as `vikaki:8787`, was refused. Host networking was the only way round.

## Decision

- **Environment variables, flag wins.** `VIKAKI_TTS`, `VIKAKI_TOKEN`, `VIKAKI_FRAME_ANCESTORS`, `VIKAKI_PERSONAS` and `VIKAKI_ALLOWED_HOSTS` do what `--tts`, `--token`, `--frame-ancestors`, `--personas` and `--allow-host` do. A flag given on the command line beats its variable. An empty variable is unset. A bad value is refused at start and the message names the variable. `VIKAKI_TOKEN` was already read; the token is never printed.
- **An allow-list, off by default.** `--allow-host` / `VIKAKI_ALLOWED_HOSTS` is a comma-separated list of exact names: `vikaki:8787` matches that port only, `vikaki` any port. It extends the local names; it does not replace them, and every unlisted name keeps the 403. The same list applies to the hub's WebSocket and the MJPEG feed.
- The browser origin rule is untouched: a browser at a listed Host is still held to "same origin or listed origin".

## Rejected

- **Accept any Host** (or a wildcard): reopens DNS rebinding for everyone, on the default port, to help one deployment.
- **Trust the container network automatically** (accept private-range Host names or a single-label name): a rebinding page can use such a name too, and it would be a guess about the deployment.
- **A config file**: out of scope for the cards; four or five variables are the whole surface a container needs.
- **Derive the allowed Host from the bind address**: `0.0.0.0` says nothing about the name a client uses.

## Consequences

A deployment that lists `vikaki:8787` is trusting that nothing else can reach that name on the network it listens on: publish the port to loopback only and keep the hub on a private network. The docs say so ([docker.md](../docker.md)).
