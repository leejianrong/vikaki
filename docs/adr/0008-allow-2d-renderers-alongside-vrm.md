# ADR-0008: Allow 2D avatar renderers alongside VRM

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian
- Supersedes: ADR-0002 (in part: the "VRM only" scope)

## Context

ADR-0002 chose stylised VRM avatars rendered with Three.js and listed 2D only as a rejected option. That framing was too narrow. The direction is cartoon-first (ADR-0005), the renderer already sits behind an `AvatarRenderer` interface, and the doodle-avatar idea (users draw a face and a mouth per vowel) needs a 2D renderer. Jian likes the 3D look and sees potential in it, so this is an addition, not a change of direction.

## Decision

The project supports more than one avatar renderer type behind the `AvatarRenderer` interface. VRM with Three.js stays the default and the first-class renderer, and nothing about its priority changes. A 2D renderer (layered sprites or user drawings, one mouth image per vowel) is allowed and will be added when it is scheduled. Lip sync, behaviour, the protocol and the demo page stay renderer-neutral. Everything else in ADR-0002 still stands: Ready Player Me stays rejected, VRM 1.0 and 0.x are both loaded through three-vrm, and photoreal output stays a non-goal (ADR-0005).

## Alternatives considered

| Option | Why not |
| --- | --- |
| Keep ADR-0002 as written | It would read as a ban on 2D, and the doodle idea needs one |
| Make 2D the default now | Not decided. The 3D look is liked and the board order is unchanged |
| Switch to 2D only | Gives up head turns and body or hand gestures that the game use case may want |

## Consequences

Buys room for doodle avatars and a lighter renderer without touching the 3D path. Costs a small ongoing discipline: new renderer-facing features go through `AvatarRenderer` so both types can support them, and tests for lip sync and behaviour should not assume WebGL. Which renderer is the default for the browser extension is a later decision, to be made on evidence from V1.6 (bundle size, content-security-policy behaviour in meeting pages).
