# ADR-0034: Idle seats glance round the room

- Status: Accepted (VIK-102)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

With the den in (ADR-0033) the seats still stare at the camera between moves. A table of people looks at things.

## Decision

- The den lists look targets (window, bookcase, pictures, clock, plants, armchair, sofa, front pictures, lamp). `look-around.ts` (pure) turns each into head angles for a seat: the yaw from the way the seat faces (capped at 0.7 rad, and a target more than 1.4 rad round is out of reach, so a far-side seat never looks at the wall behind it) and a pitch up or down (a nod is positive, so looking up is negative, capped at 0.3).
- `LookAround` is one seat's timer: a glance every 6 to 14 s, 2.5 to 5.5 s while the seat is thinking, held 0.9 to 2 s, never one of the last two targets, nearer-to-straight-ahead targets likelier. It is seeded from the page seed and the seat, so a run repeats.
- A seat does not glance while it speaks or while it is looking at whoever does (the speaker, or the thinker): a glance would fight the turn toward them. It lets go the moment that starts.
- `ReactionMotion.glance` adds the angles on top of everything else, eased faster (0.2 s) than the turn toward a speaker (0.3 s): a flick of the head.
- Eyes stay as drawn. None of the seated avatars moves its eyes apart from its head, and a cartoon dot eye that slides reads worse than a head turn.
- `?fidget=off` turns it off (the e2e `setup()` does, so tests of head pose stay still), `?fidget=fast` shortens the waits to a tenth for a test, `holdGlance(seat, name)` holds one for a picture.

## Not done

The scheduler that picks between this and the other fidgets, driven by the traits, is VIK-103; this module becomes one of its fidgets.
