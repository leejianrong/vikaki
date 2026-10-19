# ADR-0028: Table sound effects are made in the page, from the table's motion

- Status: Accepted (VIK-122)
- Date: 2026-10-19
- Deciders: Jian, Claude

## Context

The table moved (ADR-0025) but made no sound: chips, cards and a win were silent. Jian was fine with procedural sounds.

## Decision

- **Procedural WebAudio** (`sfx.ts`): oscillators and filtered noise, no sample files, so nothing to license or download. Chip clinks, a sweep, a pouring cascade, a card deal, flip and fold, a chime for a new hand, a win arpeggio, an all-in drum roll, a turn tick and a bust-out.
- **The cues come from the same plan as the motion** (`sfx-cues.ts` reads `planMotion` plus the state change), pure and tested, so a sound cannot drift from what is drawn. No protocol change: the game sends nothing about sound.
- **Beside the voices, under them**: effects go straight to the speakers at a lower level, on the page's audio clock, and only when the browser has allowed sound (the same click that unlocks the voices). Before that they are noted, not played.
- **A mute switch and a volume slider** in the table panel, remembered in the browser. An embedded page has no panel and no effects: the host owns the sound.

## Consequences

- The sounds were checked offline (each renders, is not silent, is bounded and ends), not by ear; Jian's ear is the real test and the levels are one constant (`MASTER`).
- Recorded samples could replace a recipe later without touching the cues.
