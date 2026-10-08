# ADR-0015: Emotions are a pose plus manga-style symbols

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian, Claude (KAN-1921)

## Context

The protocol has seven emotions (`neutral`, `happy`, `smug`, `worried`, `surprised`, `sad`, `angry`). The default avatar, Cookieman, has only the five vowel shapes and blink: no brows, no smile or frown, no wide eyes (probed by showing each of its 16 morph targets; `scripts/probe-morphs.ts`), and the camera frames head and shoulders, so body language is mostly out of view. VRM expression presets for emotions would show nothing.

## Decision

An emotion is a small **pose** (`EmotionPose`, `packages/engine/src/emotion.ts`) made of things this face can do: a held eyelid squint, a resting mouth shape that lip sync overrides while speaking, a head tilt and nod, a gentle bounce or a tremble, and one **manga-style symbol** drawn beside the head (sparkles for happy, a gleam for smug, a sweat drop for worried, an exclamation mark for surprised, gloom lines for sad, an anger mark for angry; "thinking dots" are reserved for V3.2). The symbols are drawn in code on a canvas, so they add no licensed assets.

- Intensity scales every number linearly from neutral and is clamped to [0, 1]; a missing or unusable intensity means full. An unknown emotion is neutral, never an error; the hub logs a warning.
- The face eases toward the pose (time constant 0.18 s, frame-rate independent); symbols fade faster (0.08 s) so a new one is up within a second.
- The page shows a line's emotion from `speech_started` and relaxes 0.7 s after it ends or is cut off.
- The same code works for any avatar through `AvatarRenderer` (visemes, blink, head pose), so a richer avatar can later map `EmotionPose` onto real expressions.

## Consequences

- Sad, worried and angry have similar faces; the symbol and head motion carry the difference. That is a limit of the avatar, not of the model.
- Presets were tuned by eye on Cookieman (`scripts/probe-emotions.ts`). Another avatar may need its own numbers.
- A resting smile counts as "mouth open" in the displayed mouth, so the first-video-frame timing reads what lip sync asked for instead.

## Thinking (V3.2)

`turn_started` shows a thinking pose that is not one of the seven emotions: head tipped up and to one side, lids a little low, dots pulsing beside the head. The face cannot look up, so the head does it. A line starting replaces it with that line's own feeling, `turn_ended` relaxes it, and a 30 s guard clears it if a driver never says the turn ended. Seats are not told apart yet: any turn shows on every page (V3.5 adds the seat and persona to pages).
