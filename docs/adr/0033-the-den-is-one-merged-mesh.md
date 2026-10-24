# ADR-0033: The den is one merged mesh with colours on its vertices

- Status: Accepted (VIK-101)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

The table sat on a dark floor in front of the page's background. Life round it (look targets, fidgets, VIK-102 to VIK-106) needs a room with things in it, and the room must not slow the page: the software renderer already needs about 50 ms a frame, and the POV grid draws the scene once per player.

## Decision

- `den.ts` builds a living room from boxes, cylinders and spheres in a warm palette: four walls with a wainscot, a rug under the table, a window with curtains, a bookcase with books, pictures, a clock, two plants, an armchair, a sofa against the front wall (what a player sees looking back across the room) and a pendant lamp. Nothing is imported, so there is no asset to license.
- Every static part is merged (`mergeGeometries`) into one mesh with a colour on each vertex: the room is **one draw call**. The pendant is a second, so it can hide for the overhead shot, whose camera sits right above it. The pool of light on the felt is a soft additive disc (a third), with no shadow map.
- The side and front walls face inward, so a camera outside a wall sees through it (the wide shot on a narrow canvas sits far back).
- The den lists **look targets** (name and world position) for VIK-102.
- `?den=off` leaves the bare table. The floor is warm wood either way.
- The draw budget of VIK-107 holds: the e2e test still limits calls and triangles, and a unit test limits the room's triangles.

## Checked

By screenshot from the wide, overhead and a POV camera. Only the room in front of the player is drawn well: the front wall is dim because the key light is behind it, which reads as the dark end of a room and is left.

## Not done

No windows that light the room, no moving props (a clock hand, a curtain): VIK-103 onwards may add small ones.
