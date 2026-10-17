# How to embed the avatar page in a game's page

For a game that frames `/avatar` in an `<iframe>` so its players have faces and voices (first user: Wavelength, VIK-E6). The hub and the avatar page keep the voice, faces and audio; the game page draws nothing of the avatars and plays no sound itself. A game server drives the hub with `vikaki-client`, one driver per seat ([ADR-0017](adr/0017-one-driver-per-seat.md)); the browser never talks to the hub except through this page.

Each section below says which card added it. Pin to the commit named on that card.

## The URL

```html
<iframe src="http://127.0.0.1:8787/avatar?seats=2&embed=1&hud=0" allow="autoplay"
        style="border:0;width:100%;height:100%"></iframe>
```

| Parameter | What it does |
| --- | --- |
| `seats=N` or `seats=north:ada,south:ben` | The table page: one avatar per seat ([personas.md](personas.md)). Without it, the page shows one avatar, `persona=` picks which. |
| `embed=1` | Avatars only (VIK-64). See below. |
| `bg=00b140` | A solid background, six hex digits. Without it the background is transparent. |
| `names=1`, `captions=1` | In embed mode, bring back the name plates under the avatars and the transcript strip. Off by default. |
| `hud=1` | In embed mode, show the small status line in the corner. Off by default (it is on outside embed mode). |

## `embed=1`

Draws the avatars and nothing else: no pot or board strip, no name plates, no transcript, no status line, no side panel, dock or controls. The background is transparent, so the host page shows through; `&bg=` paints a solid colour instead.

Things to know:

- The page drops its own `color-scheme`. A framed document is only see-through when its colour scheme matches the page around it; with `light dark` a dark-mode visitor on a light page would get a grey box.
- The canvas fills the frame and is sized by the stylesheet, so size the iframe, not the canvas.
- Without `embed=1` nothing changes.
