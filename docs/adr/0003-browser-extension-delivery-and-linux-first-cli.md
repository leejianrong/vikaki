# ADR-0003: Deliver into browser meetings with an extension, built Linux-first as a CLI; OBS is the fallback

- Status: Accepted (revised 2026-10-07 after learning Jian joins meetings in the browser)
- Date: 2026-10-07
- Deciders: Jian

## Context

The call machine runs Windows, software can be installed, the physical webcam is blocked, and meetings are joined in the browser (Google Meet, and likely Teams or Zoom web). Zoom and Meet need a camera device or a video track. An Electron app with a native virtual camera would mean per-OS drivers and signing. Jian prefers Ubuntu as the first target if simpler, and asked about CLI and container use. The games brief needs headless and browser delivery. Viewing LLM avatars (for example at a poker table) needs no meeting at all, only a web page.

## Decision

Vikaki is a CLI plus local web server, not a desktop app. Two delivery paths share one renderer:

1. **Browser extension (primary, for web meetings).** A Manifest V3 content script runs in the page's main world on the meeting sites and wraps `navigator.mediaDevices.getUserMedia`, `enumerateDevices` and `permissions.query`. Video requests receive a track from the avatar canvas (`canvas.captureStream()`), while the real mic is still used and also tapped for lip sync. A fake `videoinput` is advertised so the meeting UI shows a working camera even when the physical camera is policy-blocked. The physical camera is never opened. The avatar is rendered inside the meeting page by an injected bundle (V1 confirms this is fast enough; the alternative is rendering in an extension page and bridging frames).
2. **Web page for everything else.** `vikaki serve` serves `/avatar`, which works as a plain viewer, as a preview, and as an OBS Browser Source or Window Capture for desktop apps (Zoom, Teams). OBS Virtual Camera is a documented fallback, not a dependency.

Development, CI and the server run on Ubuntu first, with a container image in slice V4. We write no virtual-camera driver in M1.

## Alternatives considered

| Option | Why not |
|--------|---------|
| OBS Virtual Camera as the main path | Extra install, and its Browser Source may not grant mic access; kept as fallback |
| Electron + native virtual camera per OS | Drivers and signing for every OS, duplicates what the extension and OBS already do |
| Linux-only v4l2loopback | Call machine is Windows, and stock WSL2 or containers lack host support |
| Window share only | Shows as shared content rather than a camera tile; kept as the last fallback |
| Container as the only runtime | Mic access from a container is awkward, and the mic is the M1 input |

## Consequences

Buys a self-contained, no-driver path for browser meetings on any OS, and one renderer for meeting, spectator and headless use. Costs: it works only in browser meetings, relies on wrapping browser APIs that meeting apps may change or probe, and needs the extension allowed on the call machine. Company policy may block extensions, block developer-mode loading, or block the camera in a way the wrapper does not hide. Each is unverified and is the first thing V1 tests. If the extension fails, fall back to OBS, then to window share.
