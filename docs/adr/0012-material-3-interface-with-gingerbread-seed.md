# ADR-0012: Material 3 for the demo interfaces, seeded from the avatar's own colour

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian, Claude

## Context

The two demo pages (avatar demo, speech demo) were hand-styled with arbitrary hex values and sizes. They are the main way a person judges the project, so they need to be readable, consistent in light and dark, and clear about problems. A first-time visitor missed a small amber chip saying the voice was a test tone, and concluded speech was broken.

## Decision

- Use **Material 3** through Google's `@material/web` components (buttons, outlined text field, assist chips), with M3 colour roles, type scale, shape scale and state layers. Components are loaded lazily by the demo pages only, so the plain `/avatar` page, the OBS capture and the extension are unchanged and light.
- **Seed colour `#AE6E3A`**, the gingerbread avatar's baked-in brown, not Material's baseline purple. `scripts/make-theme.mjs` generates all 62 colour roles for light and dark (`src/ui/theme.css`, generated, not edited by hand), including custom `success` and `warning` roles blended toward the seed, since Material has none.
- **Type:** Material's two slots. The brand slot is **Fredoka** (OFL, rounded and friendly, self-hosted in `public/fonts`) for headings and numbers; the plain slot is the system UI font. Nothing is fetched from a font CDN, so the page still makes no requests beyond localhost.
- **The voice banner** is the signature element: a large tonal block that says in plain words whether you are hearing real speech (green), a test tone (amber, with the exact command to fix it), speech is off (red), or another driver is connected (red).
- Layout is a grid: avatar stage beside a side sheet, stacked on narrow windows. The canvas never gets an inline size, so the stylesheet decides (a layout test guards this).
- Tests find controls by their accessible role and name, which pierces the components' shadow DOM, instead of CSS classes.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Keep hand-styled panels | Drifts from any standard, inconsistent states, no light theme |
| Hand-rolled Material tokens, no library | More work and easier to drift from the spec |
| A UI framework (React, Svelte) | Heavy for two small panels, and the rest of the project is framework-free |
| Google Fonts from the CDN | Breaks "nothing leaves your machine" and offline use |
| Material baseline purple | A default, unrelated to what the page shows |

## Consequences

Buys a consistent, accessible interface in light and dark, and a failure that is hard to miss. Costs about 130 kB of lazily loaded component code on the demo pages, a generated theme file to regenerate when the seed changes, and a dependency on `@material/web`, which Google has put in maintenance mode (the components are stable; if they are ever dropped, the tokens and CSS here stand on their own).
