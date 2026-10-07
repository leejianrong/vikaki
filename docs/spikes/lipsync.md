# Lip-sync spike (V1.3)

Date: 2026-10-07. Decision: **wLipSync** (ADR-0007). Harness: `spikes/lipsync/`. Raw numbers: `lipsync-results.json`.

## Candidates

| | wLipSync 0.x | wawa-lipsync 0.0.2 |
|---|---|---|
| Licence | MIT | MIT |
| Last push | 2026-08 | 2025-11 |
| Method | MFCC matching against a calibrated profile, WASM in an AudioWorklet | Spectral band heuristics on an AnalyserNode |
| Output | Continuous weights for A, I, U, E, O, plus volume | One discrete Oculus viseme at a time (aa, E, I, O, U, plus 10 consonant shapes and `sil`) |
| Needs | A profile. The repo ships `example/profile.json`. Making new profiles needs Unity's uLipSync | Nothing |
| Browser constraint | AudioWorklet and WASM need a secure context and must be allowed by the page's CSP | None, plain Web Audio |

## Method

Each library played each clip in headless Chromium and its output was sampled every animation frame. Clips: 10 short ElevenLabs TTS clips (two voices, single vowels and short phrases), one 26 s passage, one 6 s message, 2 s of digital silence and 2 s of quiet pink noise. Onset is the first 10 ms frame above 5% of peak RMS.

## Results

| Check | wLipSync | wawa-lipsync |
|---|---|---|
| Reaction after onset (range over clips, sampled per animation frame, so about 16 ms granularity) | 0 to 30 ms | 10 to 60 ms |
| Digital silence | closed | closed |
| Quiet pink noise | opens slightly (max weight 0.12) | "consonant" in 93% of frames, mouth fully active |
| Isolated "a", two voices | `aa` in 100% and 100% of active frames | `aa` in 57% and 85% |
| Isolated "e" | `ee` 95% (Liam), `ih` 95% (Emma). Neighbouring spread-lip shapes | `ee` 77 to 79% |
| Isolated "o" | `oh` 69% (Emma), 20% (Liam, `ee` 63%) | `oh` 55%, 53% |
| "you" (target `ou`) | `ou` is the top shape at 42% | never `ou` |
| Shape changes per second, running speech | 5 to 11 | 6 to 8 |

## Reading the results

- Both react well inside the 100 ms budget (R0, Q16).
- wLipSync is better on vowels and much better in noise, because its weights scale with volume. wawa-lipsync would visibly chew along with room noise.
- wawa-lipsync reports consonants, which wLipSync does not. Of those, only closed-lip sounds (`PP`) matter for our five-shape mouth, and they are a polish item.
- Neither is clean on running speech, so a short smoothing window on the weights is needed (slice V1.4).

## Limits of this spike

- 12 clips, English, synthetic voices. No real microphone recording and no non-English speech.
- The proxy is "which vowel dominates", not a visual judgement of how natural the mouth looks. Slice V1.4 still needs a person to look at it.
- wLipSync's profile came from someone else's calibration. It generalised across two voices here, but a user's own voice may be worse, and we cannot make a profile without Unity. A small calibration tool is a possible follow-up.

## Risk carried into V1.6

wLipSync needs an AudioWorklet (inlined as a blob) and WASM. A meeting page's Content Security Policy may block both when the code runs in the page's own world. If so, either run lip sync in an extension-owned context and send weights to the page, or fall back to wawa-lipsync, which needs neither.
