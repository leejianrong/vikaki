# ADR-0037: A restack riffles the chips; the hand reaches where it can

- Status: Accepted (VIK-105)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Decision

- The `restack` fidget (ADR-0035) is chosen for a seat with chips in front of it and arms that bend (it is a reaching fidget). It lasts 2.6 to 3.4 s, likelier than the idle extras.
- `restack.ts` (pure) changes only how a seat's stack is drawn for a moment: the top chip of the tallest column lifts, crosses to sit on the neighbouring column and comes back, the chip under it follows a little behind; a single column has its top chips slid aside and back. The stack is as it was throughout, so a restack is never a bet or a count; the chips are laid out again each frame (`layoutChips`, split out of `draw`) and no chip passes through the table (a test).
- **Per-avatar fallbacks.** The left hand reaches in (`ArmActs.reach`: forward, down and the elbow in and working, on top of any act in progress) where the avatar's arms bend. The stack lies on the seat's left for every seat (`seatSlots`' `across`), so the left hand is the near one. An avatar whose arms cannot (a persona with `pose.arms: hang`) is **not chosen** for this fidget at all, as with the other reaching ones (ADR-0035): no fake. The head dips toward the chips in either case, through the same glance offset as a look and a peek.
- A restack cut short by a line or a reaction runs on to its end three times faster, so a lifted chip does not jump back.

## Checked

By screenshot, frozen mid-restack (`holdRestack`), from the wide shot at double resolution: chips moved off their columns, the heads dipped, and the left arm of the gingerbread and the snowman reached toward the chips. The cactus's stubby arm moves too, but less. No avatar needed the fallback; it is the `canAct` test.
