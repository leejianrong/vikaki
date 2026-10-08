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

The gate lives in `packages/audio/src/metrics.ts` and is tested against a committed real clip (`packages/audio/test/fixtures/`). With the real voice installed, set `VIKAKI_KOKORO_PATH` (see docs/tts.md) and the same test also runs the live engine.

Inspect any file by hand: `pnpm exec tsx scripts/probe-audio.ts some.wav` prints the numbers and writes a spectrogram next to it.

## Phase 2, part 1: the page records its own timeline

The avatar page can remember what it did, on one clock (milliseconds since the page started, from `performance.now()`). It is on in the speech demo and with `?timeline=1`, and reachable as `window.__vikaki.timeline` (`TimelineRecorder`, `packages/engine/src/timeline.ts`):

| What | How |
| --- | --- |
| Every rendered frame: the **commanded** mouth (five weights), the **applied** mouth, loudness, blink | `frames()`; kept for the last 10 minutes at 60 fps |
| Events, stamped on the page clock: `sent`, `cancel`, `started`, `finished`, `interrupted`, `blink`, `error`, and `driver:started` and so on (what the driver was told, to compare with the page) | `events()` |
| Each spoken piece of an utterance (`sentence_index`, `sentence_text` from the hub) with when it was heard, and its audio | `utterance(id)`, `utterances()` |
| All of it as JSON, with audio optional | `toJSON({ fromMs, toMs, includeAudio })` |

**Commanded vs applied.** Commanded is what lip sync asked for. Applied is read back after the avatar updates, from the morph targets behind each mouth shape (`VrmAvatar.appliedVisemes`), so a blend or override that changes the mouth shows up. On the current avatar (Cookieman) the two are equal to within rounding, which is itself useful: it shows nothing is pulling the mouth away. They will differ once emotions with overrides arrive (V3).

**When audio is heard.** Audio is scheduled on the Web Audio clock. `Output.perfMs` converts that to the page clock using the context's output timestamp, which includes the output device's latency; while the browser has not yet allowed sound, the page's own clock is used. An e2e test checks that the `started` event falls within 250 ms of the first piece's scheduled start on a normal machine.

The timeline view and karaoke (the next PRs) draw this data.

## What this cannot tell you

It cannot say whether speech sounds good or is the right words, only that it is speech-like. Whether the mouth follows the voice is Phase 3's scorecard.
