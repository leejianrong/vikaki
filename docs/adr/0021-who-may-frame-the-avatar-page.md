# ADR-0021: Who may frame the avatar page: `--frame-ancestors`, enforced by the browser

- Status: Accepted (Wavelength asked for it, VIK-65)
- Date: 2026-10-17
- Deciders: Jian, Claude (VIK-65)

## Context

A game page on one localhost port frames the hub's `/avatar` on another (docs/embed.md). Until now nothing said who could do that: the server sent no `X-Frame-Options` and no `Content-Security-Policy`, so any web page, on any origin, could put the avatar in a frame. The frame is harmless on its own (it shows an avatar), but a framed page is also a viewer on the hub's WebSocket, hears every line spoken, and with ADR-0020 now talks to its parent. "Who is my parent" should be a decision, not an accident.

Already true and unchanged: the hub's WebSocket accepts a browser only from the hub's own page (`Origin` equal to `http://<Host>`), and only when `Host` is `127.0.0.1`, `localhost` or `[::1]` (DNS rebinding). A framed page is the hub's own page, so it passes both. The embedding page cannot open the socket itself, and should not.

## Decision

`vikaki serve --frame-ancestors <origins>` (and `frameAncestors` on `startServer`): the origins whose pages may frame `/avatar`.

- **Enforced by the browser**, not by the hub: every `/avatar` response carries `Content-Security-Policy: frame-ancestors 'self' <origins>`. A page on any other origin that tries to frame it gets the browser's error page; nothing of ours loads, so nothing connects to the hub.
- **Default: localhost on any port**, `http://127.0.0.1:*` and `http://localhost:*`. A game on one port and the hub on another works with no flag; a page on a real website does not. Plain `http` and loopback names only: remote and HTTPS hosting are out of scope.
- **A configured list replaces the default.** Exact bare `http(s)` origins, comma-separated, no wildcards (`*`, `http://127.0.0.1:*`, `https://*.example` are refused at start-up with a message). `none` means nobody (the page itself still may). To allow localhost as well as a site, list both.
- **`?parent=` must name an allowed origin.** The page turns on its messages to a host only when told the host's origin (ADR-0020). The hub refuses to serve a page whose `?parent=` is not in the list (403, with the flag to add), so a typo or a stale origin fails loudly instead of by silence in the browser. By default any localhost origin passes.
- **The token is not part of framing.** `--token` guards drivers (`hello`) and the MJPEG feed. The avatar page is a viewer and never needs it, so an embed URL carries no token, and must not (the URL is visible to the host page).

## Alternatives considered

- **Check the `Referer` or `Origin` of the page request.** Not sent reliably for navigations in frames, and spoofable by non-browsers; the browser's own header check is the one that actually stops a framing.
- **`X-Frame-Options`.** Cannot name more than one origin, and is superseded by `frame-ancestors` in every browser that matters.
- **No default (leave it open).** Matches today, but an open default means the next feature that trusts a parent is open too. Localhost-only costs nobody who is developing against it.
- **Wildcards.** A list you write is a list you read. `*.example` is how a forgotten subdomain becomes a way in.
- **Loosen the WebSocket origin check for the host page.** Not needed (the frame is the hub's own page), and it would let the host page open the socket itself, which Wavelength does not want either.

## Consequences

- A page on another origin that framed `/avatar` before (nothing in this repo did) now needs `--frame-ancestors`.
- `[::1]` is not in the default: CSP host sources have no IPv6 literal syntax that browsers agree on. List it by hand if needed, or use `localhost`.
- The Chrome-extension, OBS browser sources, `vikaki stream` and the headless renderer open the page as a top-level page, never framed, so they are unaffected.
