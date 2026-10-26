# Choosing a voice provider for the poker table (VIK-140)

Kokoro is the baseline and stays the default: free, local, deterministic enough, no key. It has no way to be told *how* to say a line (a smug taunt and a nervous thought sound alike), which is what the three candidates add. This page says what was built to compare them, how to run it, and what is still to decide. The decision is Jian's; nothing here spends money unless you set a key or start a pod.

## What was built

- **`SpeechApiTts`** (`packages/tts/src/speech-api-tts.ts`), a `Tts` for any server with an OpenAI-style `POST {baseUrl}/audio/speech` that answers with raw 16-bit mono PCM (a WAV answer is accepted too). `PROVIDERS.openai()`, `.chatterbox()` and `.qwen()` give the options for each. `SynthesisRequest` has a new optional `style` (free text, additive); the adapter sends it as `instructions`.
- **`styleFor(emotion, { thought })`** turns a line's emotion into that text ("Slow and pleased with yourself, teasing."; a spoken thought is "Muttering to yourself, quietly...").
- **The bench** (`scripts/tts-bench.ts`, lines in `scripts/tts-bench-lines.json`): ten poker lines (short, long, numbers, names, and six emotions); [voice-rubric.md](voice-rubric.md) says how to score them blind through each engine that is set up. It writes a WAV per line and `results.md` with time to first audio, total time and speed against playing time.
- **`speechStats` and `costOf`** read a hub `--event-log` and price the speech of a real game with each provider.
- Tests use fakes only (`fetch` is injected; `FakeTts`): no test calls a service, and none can see a key.
- Not wired into `vikaki serve` yet: `--tts openai` and the emotion-to-style plumbing in the speech engine wait for the choice, because the voice ids (`af_heart`...) map differently for each provider.

## Run it

```bash
pnpm exec tsx scripts/tts-bench.ts --engines kokoro            # the baseline, if `make install-voice` was done
pnpm exec tsx scripts/tts-bench.ts --engines fake              # no engine at all: check the harness
OPENAI_API_KEY=... pnpm exec tsx scripts/tts-bench.ts --engines openai   # a few cents; the key stays in the environment, never printed
CHATTERBOX_URL=http://<pod>:<port>/v1 pnpm exec tsx scripts/tts-bench.ts --engines chatterbox
QWEN_TTS_URL=http://<pod>:<port>/v1   pnpm exec tsx scripts/tts-bench.ts --engines qwen
pnpm exec tsx scripts/tts-bench.ts --engines kokoro,openai --log game.jsonl   # also prices the speech in a played game
```

An engine whose key or server is missing is skipped with the fix, so the bench runs with whatever is set up. Listen to the WAVs side by side (`tts-bench-out/`): speed is half of it.

### Chatterbox or Qwen3-TTS on RunPod

Neither ships as an OpenAI-style server by itself; run one that does. This was **not tried** (no pod or key was set up), so check each claim before relying on it:

- Chatterbox (MIT-licensed model): a community server such as Chatterbox-TTS-Server offers `/v1/audio/speech`. Its emotion control is an `exaggeration` number, not free text; pass it with `extraBody` and map `styleFor`'s emotions to it when you wire it.
- Qwen3-TTS (Apache-2.0): free-text `instruct` for emotion, nine preset voices, a VoiceDesign mode, cloning. Use a server that maps `instructions` to `instruct`.
- Use the `runpod-jobs` skill for the pod: rent it, run the bench from your machine against its port (or run the bench on the pod and copy the results out), and tear it down; a pod bills while it is up.

## Cost of a 20-hand game

Measured from a real played game (see below), not guessed. Prices are assumptions as of 2026-10 and in `packages/tts/src/cost.ts` with the date; change them there.

A real 20-hand game (three Claude-era models through OpenRouter at 2.8 cents, `--pace fast`, `--event-log`): **75 spoken lines, 5,168 characters, about 5.7 minutes of audio, over a 14-minute game**. (The rough guess of 20,000 characters and 18 minutes was too high: the talk governor and the engine-decided moves keep the table quiet.)

| Provider | Per game | How it was worked out |
| --- | --- | --- |
| Kokoro (local) | $0 | runs on this machine |
| OpenAI gpt-4o-mini-tts | about $0.09 | 5.7 min at about $0.015 a minute |
| Chatterbox on RunPod | about $0.09 | a pod at about $0.40 an hour is up for the whole 14-minute game (it bills while up, so a long game costs more, not the speech); plus a cold start and your time |
| Qwen3-TTS on RunPod | about $0.09 | the same assumption |

So at this volume a hosted API and a rented pod cost about the same per game, and the pod only wins if it is kept up for many games in a row. Check the real prices before relying on these. Reproduce with `pnpm exec tsx scripts/tts-bench.ts --engines fake --log game.jsonl` on the log of any game made with `pnpm serve --event-log game.jsonl`.

Measured now, on this machine: **Kokoro**, the ten bench lines (VIK-142, [baseline](spikes/voice-baseline.md)), first audio in 855 ms on average and speech made 3.1x faster than it plays. The others were not run (no key and no pod).

## What to decide

- **gpt-4o-mini-tts** is the least work (a key, no server) and takes free-text tone, but every game costs money and the voice leaves the machine.
- **Chatterbox on RunPod** gives good emotion through one number, needs a pod up while playing and a cold start before the first line, and costs by the hour not the line.
- **Qwen3-TTS** is the best fit on paper (free-text direction, Apache-2.0, voice design) and the least known here: an unproven server route and an unmeasured speed.
- Whichever is chosen, keep Kokoro as the fallback when the provider is down: `Tts` is one interface and the hub already reports a failure as `tts_failed`.
