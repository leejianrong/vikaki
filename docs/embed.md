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
| `layout=duet` | Two seats facing each other round a clear central band (VIK-68). See below. |
| `names=1`, `captions=1` | In embed mode, bring back the name plates under the avatars and the transcript strip. Off by default. |
| `hud=1` | In embed mode, show the small status line in the corner. Off by default (it is on outside embed mode). |

## `embed=1`

Draws the avatars and nothing else: no pot or board strip, no name plates, no transcript, no status line, no side panel, dock or controls. The background is transparent, so the host page shows through; `&bg=` paints a solid colour instead.

Things to know:

- The page drops its own `color-scheme`. A framed document is only see-through when its colour scheme matches the page around it; with `light dark` a dark-mode visitor on a light page would get a grey box.
- The canvas fills the frame and is sized by the stylesheet, so size the iframe, not the canvas.
- Without `embed=1` nothing changes.

## `layout=duet`

For a two-player game that draws its own board between the players. Needs `seats=2` (any other number is an error on the page). Works with `embed=1`.

- **Wide canvas (772 px or more):** the left seat on the left, the right seat on the right, each turned about 30 degrees toward the other, and a **band 440 px wide, centred, full height** with nothing of the avatars in it. Draw your dial there. The avatars hug the band and are as big as the height and the room beside the band allow.
- **Narrow canvas (under 772 px, a phone):** the avatars stand side by side above a **full-width band** at the bottom, as tall as a half-circle dial (half the width plus 32 px, at most 60% of the canvas height). The avatars are cut off at the band's top edge.
- **The speaker is marked:** the avatar whose line is heard is at full brightness with a warm halo behind the head; the other is dimmed to about 60%, and glances toward the speaker. While someone is thinking (`turn_started`) the same marks follow the thinker. With nobody speaking both are normal. The halo and the dimming ease in and out over about a quarter of a second.
- Size the iframe to the canvas you want; the page measures itself, so the band is always centred in the frame (or at its bottom).
- `names=1` puts the name plates along the bottom of the frame, which in duet is inside the band: leave it off and draw names yourself.

A test samples the band while a seat speaks and fails on any pixel of the page in it, at 1280x720, 960x540 and 390x844 (`packages/e2e/test/embed.e2e.test.ts`).

| Desktop 1280x720 | Small laptop 960x540 | Phone 390x844 |
| --- | --- | --- |
| ![](img/duet-desktop.png) | ![](img/duet-laptop.png) | ![](img/duet-phone.png) |

(The dashed outline marks the band and is drawn by the screenshot script, not by the page. The seat on the left is speaking.)
