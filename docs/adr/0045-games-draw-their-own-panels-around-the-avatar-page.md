# ADR-0045: Games draw their own panels around the avatar page; no generic overlay message

- Status: Accepted (VIK-70)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

`table_state` (ADR-0018) carries a pot, a board, stacks, cards and a poker-shaped `event`. The page draws it as an overlay, a spectator panel and a 3D table. A game that is not poker needs little or none of that: Wavelength draws its own dial between two avatars. The question on VIK-70 was whether to add a small game-agnostic state or caption overlay, or to leave games to draw their own panels around an embedded avatar page.

## Decision

**Games draw their own panels. No generic overlay message is added.**

- A game embeds the avatar page (`embed=1`, `layout=duet`, a clear band) and draws everything else in its own page, in its own style, with its own accessibility and layout. Embedding is the supported path ([embed.md](../embed.md)).
- What a game cannot draw itself, the page already offers: name plates (`names=1`), the transcript strip (`captions=1`), the speaker halo and the thinking marks, and the speech events over `postMessage` (`speech_started`, `speech_finished`) so the game's own panel can follow who is talking.
- `table_state` stays what it is: an optional, poker-shaped message for the table page and the poker example. A non-poker game never sends it. Its optional fields are not widened for other games.

## Why

- **One consumer.** Only poker and Wavelength exist. A generic overlay designed from one example is a guess, and an additive protocol cannot take a guess back: once a field ships it stays for the whole major version ([embed.md](../embed.md) stability, VIK-132).
- **The overlay's value is the game's own look.** A generic caption box would look like Vikaki, not like the game, and a game that cares would draw its own anyway. A game that does not care can turn on `captions=1`.
- **Cost and surface.** Every generic field is page code to build, test and keep accessible (roles, contrast, the layout tests) and a contract to keep stable.
- **The speech events already give a game the hook** it needs to light up its own panel.

## Rejected

- **A `caption` or `overlay` message** (title, lines, a value, a marker): the shape would be invented from one game; a second game would want different fields.
- **Slots for host-supplied HTML in the page**: an injection and security cost for a thing an `<iframe>` beside a `<div>` already does.
- **Making `table_state` generic** (renaming pot and board): breaks the poker example and the protocol's additive rule.

## Reopen when

Two games ask for the same thing the page does not give them, and the thing is not a look that each would rather draw itself. Then the shape comes from what both asked for, as an additive message.
