# Observability

How to see what the avatar is doing and saying, without a person listening. Phases are in CLAUDE.md.

## Phase 1: the debug recorder

```bash
pnpm serve --debug-dir .vikaki/debug     # any speech engine; "off" disables it
make demo-speech                         # records by default into .vikaki/debug (git-ignored)
```

Each utterance gets a folder `<time>-<n>-<utterance id>/` with:

| File | What |
| --- | --- |
| `audio.wav` | Exactly what the engine produced, mono 16-bit, at the engine's rate |
| `spectrogram.png` | Time to the right, 0 to 8 kHz up, loud is bright. Ticks every 500 ms (long at each second) and every kHz |
| `metrics.json` | The numbers below, plus `verdict` (`speech`, `buzz` or `silence`) and `reasons` |
| `text.txt` | The text pieces sent to the engine, one per line |
| `timings.json` | Outcome (`completed`, `cancelled`, `failed`), time to first audio, and per piece: when it started, when its audio came, and where that audio sits in the recording (`audioStartSec` to `audioEndSec`) |

Writing never affects speech: a disk error is reported on the console and the driver still gets `speech_finished`. Folder names use a sanitised utterance id, so a driver cannot write outside the directory. Nothing is pruned; delete the folder when you are done.

## Speech or buzz

| Metric | Meaning | Real speech (Kokoro, 3 clips) | Test voice (`FakeTts`) | Cut-off |
| --- | --- | --- | --- | --- |
| `loudnessVariation` | std / mean of frame loudness over the active frames | 0.55 to 0.63 | 0.08 | at least 0.2 |
| `spectralWanderHz` | std of the spectral centroid over the active frames | 1,669 to 2,095 | 2 | at least 300 |

Both must pass: a tone that only wobbles in loudness, or speech flattened to one level, is still a buzz (tests cover both). "Active" is within 30 dB of the clip's 95th-percentile loudness. Pauses are quiet gaps of at least 150 ms between active parts; leading and trailing silence does not count.

The gate lives in `packages/server/src/debug/metrics.ts` and is tested against a committed real clip (`packages/server/test/fixtures/`). With the real voice installed, set `VIKAKI_KOKORO_PATH` (see docs/tts.md) and the same test also runs the live engine.

Inspect any file by hand: `pnpm exec tsx scripts/probe-audio.ts some.wav` prints the numbers and writes a spectrogram next to it.

## What this cannot tell you

It cannot say whether speech sounds good or is the right words, only that it is speech-like. Whether the mouth follows the voice is Phase 3's scorecard.
