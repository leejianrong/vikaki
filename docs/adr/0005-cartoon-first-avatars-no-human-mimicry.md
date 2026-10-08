# ADR-0005: Cartoon-first avatars, no pursuit of realism or human mimicry

- Status: Accepted
- Date: 2026-10-07
- Deciders: Jian

## Context

The initial discussion surveyed photoreal digital humans (HeyGen, Tavus, LivePortrait, SadTalker). Jian wants the project to be cute and cartoony and does not want avatars that look uncanny or creepy by imitating humans. The games brief reaches the same view for game opponents: a stylised character avoids the uncanny valley and gives each seat a clear personality.

## Decision

Avatars are stylised and cartoony by design. Photorealism and human mimicry are non-goals, not deferred features. Expressiveness comes from exaggerated, readable emotion, mouth shapes and idle behaviour rather than from fidelity. Photoreal and neural talking-head renderers (hosted or self-hosted) are out of scope for the project.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Photoreal option as a premium tier | Pulls the project toward the uncanny valley and toward expensive per-stream GPU cost, and dilutes the identity |
| Realistic-but-stylised middle ground | Hardest zone for avoiding the uncanny feeling |

## Consequences

Buys a coherent identity, cheap local rendering, and room for playful features such as user-drawn avatars. Costs the "digital twin of me" market, which the paid players serve. Forecloses a hosted neural-rendering tier; the commercial layer must come from hosting, orchestration and assets instead. The renderer should stay behind an interface so other cartoon styles (2D sprites, user doodles) can be added next to VRM.
