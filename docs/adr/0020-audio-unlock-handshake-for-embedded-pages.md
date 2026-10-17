# ADR-0020: The embedding page unlocks sound with a `postMessage` handshake

- Status: Accepted (Wavelength asked for it, VIK-66)
- Date: 2026-10-17
- Deciders: Jian, Claude (VIK-66)

## Context

A browser keeps a page silent until the person has clicked on it. When the avatar page is framed by a game's page on another origin, a click on the game page is not a click on the avatar page, so the first lines spoken would be silent. Wavelength's spike saw exactly that: "the first spoken line after load is silent until the person clicks inside the avatar frame; a click on the parent page does not unlock it; `allow="autoplay"` made no difference".

The spike's page never asked the browser again after the parent's click: the avatar page only called `resume()` from events inside its own window. So the real question was whether a parent's click can unlock a cross-origin frame when the frame is told to try. It can, under one condition. The evidence is below.

## Decision

A small, additive `postMessage` protocol between the avatar page (in embed mode) and the page that frames it. It is described for hosts in [embed.md](../embed.md).

- **Page to host.** `{ "type": "audio_locked" }` while the browser blocks sound, `{ "type": "audio_unlocked" }` once it does not. Sent when the state is known (after the audio context exists) and when it changes. The page also shows a small "Click for sound" button, because a click inside the frame always works and a host that does not implement the handshake still has a way out.
- **Host to page.** `{ "type": "unlock" }`, sent from the host's own click handler: the page resumes its audio context. `{ "type": "audio_status" }` asks the page to say where it stands again (for a host that attached its listener late).
- **The host names itself.** `?parent=<origin>` on the iframe URL, a bare `http(s)` origin. Without it, or with anything else (`*`, a path, another scheme), the page posts nothing and obeys nothing; the button still works.
- **Never `*`.** Posts use that origin as the target, so a page framed by anyone else gets nothing delivered. Incoming messages count only if `event.source` is the parent window and `event.origin` is the named origin. Where the browser says who the ancestor is (`location.ancestorOrigins`, Chrome and Safari), it must agree with `?parent=`.
- **The iframe needs `allow="autoplay"`.** Without it the browser refuses the resume.

Protocol rules of the repo hold: nothing here touches the hub protocol, and `protocol_version` stays 1.

## Evidence

Chromium 156 (Playwright), a host on one localhost port framing the avatar page on another, the browser's real autoplay policy (a page that makes its own `AudioContext` gets it `suspended`):

| Setup | Result |
| --- | --- |
| No click, no message | `suspended`; the page tells the host `audio_locked` |
| Host click only (no `unlock` sent) | stays `suspended` (Chrome does not pass the parent's gesture down by itself) |
| Host click, then `unlock`, iframe has `allow="autoplay"` | `resume()` resolves, `running`; the next line goes to the speakers and the audio clock runs |
| Same, iframe without `allow` | stays `suspended`, the click and the message change nothing |
| Same, `allow="autoplay 'none'"` | stays `suspended` |
| Click on the button inside the frame | `running`, with or without `allow` |

Tested by `packages/e2e/test/embed-audio.e2e.test.ts`, which also pins the security rules (a host that is not the named one hears nothing and its `unlock` is ignored; no `?parent=` means silence).

Not tested: Firefox, Safari, and Chrome with a head on Windows. The mechanism is the platform's (`allow="autoplay"` is the documented way for a top page to delegate autoplay, and a gesture on the top page counts for a delegated frame at the time of the `resume()` call), but Safari in particular has its own rules. Hosts should check their target browser once by hand; the button is the fallback if it does not work there.

### Testing a gate that headless Chromium appears to leave open

The spike found headless Chromium reporting `running` with no click. The gate is in fact shut there; it was opened by the test tooling. Playwright's `evaluate` and `waitForSelector` run with a user gesture, and a gesture before the page has made its audio context means the context starts running. The same happens to a context made inside `evaluate`. The rule for a test of the gate: read the page's state only from what the page tells the outside (its messages to the host, its console), and do not touch the frame until it has said it is locked. The e2e test waits for the page's console note and says so if the gate turns out to be open, instead of passing for nothing.

## Alternatives considered

- **A click-through overlay on the host, forwarding clicks into the frame.** Not possible across origins; the host cannot send a trusted click.
- **Make the host's page serve the avatar page (same origin).** Defeats the point of a hub that owns the page, and needs the hub's assets on the game's server.
- **`allow="autoplay"` alone.** The spike tried it. Without the page calling `resume()` again it changes nothing.
- **Auto-detect the host from `document.referrer` or `ancestorOrigins`.** `referrer` can be stripped by policy and `ancestorOrigins` is not in Firefox. An explicit `?parent=` is the same everywhere. `ancestorOrigins` is still used, as a cross-check.
- **Only the in-frame button.** Works everywhere but costs the player an extra click on something they did not know about; the handshake removes it where it can.

## Consequences

- Embed mode makes one more small element (the button) and a 100 ms check of the audio state. Outside embed mode nothing changes.
- The host must say who it is in the URL. VIK-65 will make the hub enforce that the origin in `?parent=` is one it was told to allow.
- The speech events for the host (VIK-67, optional) will use the same `?parent=` origin and the same rules.
