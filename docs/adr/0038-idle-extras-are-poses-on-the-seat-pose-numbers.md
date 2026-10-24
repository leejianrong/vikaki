# ADR-0038: The idle extras are poses on the seat-pose numbers

- Status: Accepted (VIK-106)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Decision

- Four more fidgets for the scheduler (ADR-0035): **tap** the fingers (the right forearm lifts and comes down four times, never pressing into the table), **lean** back, **stretch** (both arms up, the body back, the head tipped back) and **scratch** (the right hand up toward the neck and chin, working). `extras.ts` (pure) gives each as changes to the arms' seat-pose numbers (`forward`, `down`, `elbow`, as in ADR-0031), how far the body leans, and a turn of the head; `ArmActs.extra` layers the arms on whatever else is playing.
- **Per-avatar fallbacks.** Tap, stretch and scratch need arms that bend, so the scheduler does not pick them for an avatar that cannot (ADR-0035). Lean needs only a body: `setLean` tips the spine and chest (`LEAN_BACK` 0.3 rad over both) and the arms and hands come with it; an avatar with no spine bone still dips its head back a little.
- Lean is not a reaching fidget, so even a `pose.arms: hang` avatar leans.
- A fidget cut short by a line runs to its end three times faster, as a restack does.

## Checked

By screenshot, frozen mid-way (`holdExtra`), on all three seated avatars (gingerbread, snowman, cactus): stretch is clear on all three; tap is a small forearm lift; lean tips every head back and down in the frame; scratch ends with the hand at the neck and chin, not on the top of the head (the numbers for a hand on the head would cross the body for these arms). The arms are not tested against the table geometry: the offsets only lift (a tap) or raise (stretch, scratch) them, which a unit test holds.
