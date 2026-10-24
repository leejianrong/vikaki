# ADR-0041: A table of six or more looks down on the near seats

- Status: Accepted (VIK-88)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

Up to four seats sit along the far side of the oval, facing the camera. From five up they go round the whole oval, so some sit on the near side with their backs to the wide camera, which stands over the near rail: their heads come between it and the table, a row of name plates along the bottom piles the near seats on the far ones, and a seat's close-up is squeezed against the seat across from it. The page already allows 8 seats (`MAX_SEATS`) and has seven avatars.

## Decision

- **`crowded(spots)`** (any seat on the near side) switches three things, all in `cameras.ts` and the overlay; a table of four or fewer is exactly as it was.
  - The **wide shot** (and the grid's resting camera) looks down from higher and further back (about 40 degrees, `0.85 *` the distance up), far enough for the whole oval, so the line to the middle of the table clears the near seats' heads. A test holds this for 5 to 8 seats and three aspect ratios, with every head and the board in view.
  - The **board shot** comes from over the table's near half, so it is not inside a near seat's head.
  - A **close-up** is a quarter nearer and a little higher, so it is not squeezed against the seat across (a test: 0.5 m clear of every other head, own head in view).
- **Plates** are small and sit by each head (`.crowded`), not in a row at the bottom; an e2e test holds that none overlaps another.
- Six characters to play it: `personas.table7.example.yaml` (the usual three and the four other avatars in `public/avatars`: froggy, lilbro, mushy, wambo, as fifi, leo, mo and wim) and `examples/poker/table6.example.yaml` (six seats), `make demo-table6`.

## Checked

By screenshot at six and seven seats: all seated, the wide shot clear of the near seats, plates by the heads. The four new avatars sit acceptably with the default pose (arms on the table), so no `pose` is tuned; the mushroom's hat is wide and hides some of the table when its seat is on the near side, which looking down makes acceptable. At six seats the page draws about 31k triangles and 18 calls (the budget of ADR-0033 is for three seats and was left as it is).

## Not done

The panel's seat cards are a strip that wraps to two rows; at seven or eight seats a scroll may be wanted. The fidget's look targets are chosen for the far side (a near seat faces the window and the bookcase, which it can reach).
