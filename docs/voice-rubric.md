# Judging a voice (VIK-142)

How Vikaki compares text-to-speech engines, so "better" means something. The same ten lines go through each engine; a person listens blind and scores; the script supplies the numbers a person cannot hear. Epic VIK-E12 uses this to choose the next voice ([tts-providers.md](tts-providers.md) has the engines and how to run them).

## Render the set

```bash
pnpm exec tsx scripts/tts-bench.ts --engines kokoro,chatterbox,openai --blind --out voice-out
```

- One untimed warm-up line runs first, so a model load or a connection set-up is not charged to line 1. A cold start is measured on its own.
- `--blind` names every clip `A01.wav`... in a shuffled order (`--seed` changes it) and writes the answer to `voice-out/key.json`. Score all clips before opening it.
- `results.json` (numbers only, no audio) is written every time. The Kokoro baseline is [spikes/voice-baseline-kokoro.json](spikes/voice-baseline-kokoro.json).
- An engine whose key or server is missing is skipped with the fix. Nothing is sent anywhere for an engine you did not name.

## The listening set

`scripts/tts-bench-lines.json`: ten poker-table lines, each tagged with what it tests.

| Line | Tests |
| --- | --- |
| short ack ("Fold.") | one word; clipped starts and ends |
| taunt, excited rush, sad bust-out, angry fold | tone: does the emotion come through |
| numbers ("1,250", "3.5", "$4,800") | numerals said right |
| names (Siobhan, Nguyen, Marguerite, Xavier) | unusual names |
| worried thought | quiet inner voice |
| question | rising intonation |
| long story (224 characters) | pacing, breath, drift over a long run |

Change the set only with a reason, and then re-render the baseline: scores from different sets cannot be compared.

## Scores, 1 to 5 per clip

Listen on the same headphones, in one sitting. Score each clip on each row; half points are fine.

| | 1 | 3 | 5 |
| --- | --- | --- | --- |
| **Naturalness** | Robotic; you would stop listening | Clearly synthetic but easy to follow | Could be a person on a call |
| **Pacing** | Rushed, dragging, or mid-line pauses in the wrong places | Even but flat | Pauses and speed follow the meaning |
| **Emotion** | The tone is wrong or absent | Right direction, muted | The line sounds like what it says (smug, nervous, angry) |
| **Artefacts** | Clicks, buzzing, clipped words, mispronounced numbers or names | A glitch or two | None noticed |

A clip with a misread number or name scores at most 2 on Artefacts, whatever else it does well. The result for an engine is the mean of each row over the ten clips, kept as four numbers, not one: an engine can be natural and flat.

## What the script measures

| Number | Meaning | Why it matters |
| --- | --- | --- |
| First audio (ms) | From asking to the first chunk | The pause before the avatar starts speaking |
| Total (ms) and Speed (x) | Time to make the line against how long it plays | Above 1x keeps ahead of playback |
| Chunks | 1 means the engine did not stream the line | Streaming decides how soon a long line starts |

For comparison: the hub aims for about a second to first audio (ADR-0010, VIK-116). Report means and the worst line; the long line is the one that shows streaming.

## What this does not decide

Licence, price, data terms, offline use and ops are the spike write-ups' job (VIK-143, VIK-144), and the choice is the ADR's (VIK-145). The rubric only says how the voice sounds.
