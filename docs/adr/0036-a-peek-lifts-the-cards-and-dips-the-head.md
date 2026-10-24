# ADR-0036: A peek lifts the near edge of the cards and dips the head

- Status: Accepted (VIK-104)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Decision

- The `peek` fidget (ADR-0035) is chosen only for a seat that holds cards it has not folded, never at the showdown, likelier while it thinks. It lasts 2 to 2.6 s.
- `peek.ts` (pure) gives the curve: the head dips first (0.28 rad, through the same glance offset as a look), the cards come up (their near edge, the one toward the player, turned up by up to 0.9 rad about it), hold, and settle before the head lifts. `TableProps.setPeek(seat, amount)` places the two cards (about the line across the seat, so it works for any seat round the oval) and keeps the lift through a redraw. The page eases the amount (0.08 s) so a seat cut short by a line puts its cards down and does not snap.
- **Cards are never turned face up to the camera**: only the backs lift, and a hand turned face up at the showdown is not lifted. The panel's hole-cam still shows the cards (VIK-97) when the audience asks.
- The arms do not move: peeking needs no reach, so every avatar can do it, the stick-armed ones too. The cards move on their own, as they do for a decision (ADR-0031).

## Checked

By screenshot, frozen at full lift (`holdPeek`), from the wide shot and a close-up of the gingerbread seat.
