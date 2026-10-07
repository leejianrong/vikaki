# ADR-0007: Use wLipSync for audio-driven lip sync, with wawa-lipsync as the fallback

- Status: Accepted
- Date: 2026-10-07
- Deciders: Jian, on the evidence in `docs/spikes/lipsync.md`

## Context

The plan assumed a pure-TypeScript lip-sync library would be good enough (Q8) and named wawa-lipsync first. The spike compared it with wLipSync on 12 clips.

## Decision

Use wLipSync (MIT, MFCC in an AudioWorklet with WASM) to turn mic and TTS audio into weights for `aa ih ou ee oh`, scaled by volume and lightly smoothed. Keep wawa-lipsync as a documented fallback, behind the same `AvatarRenderer` and lip-sync interface, for any context where an AudioWorklet or WASM is blocked.

## Alternatives considered

| Option | Why not |
| --- | --- |
| wawa-lipsync as primary | Opens on quiet noise, never produced `ou` in the test, and has a stale release cadence. Its one advantage is consonant visemes |
| Write our own formant mapper | More work than needed while wLipSync meets the latency and accuracy targets |
| Amplitude-only jaw flap | Cheap but loses vowel shapes, which the doodle-avatar idea also needs |

## Consequences

Buys better vowel accuracy, noise robustness and continuous weights that blend well. Costs a WASM and worklet dependency that a meeting page's CSP might block (tested in V1.6), and a profile we cannot regenerate without Unity. A calibration tool or a switch to the fallback are the escape hatches.
