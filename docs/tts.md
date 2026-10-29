# Text to speech

Vikaki speaks through a `Tts` interface (`packages/tts`). Engines yield audio as it is produced.

| Engine | Use | Needs |
| --- | --- | --- |
| `FakeTts` | Tests and development. Deterministic "aah" audio, timing you can predict | Nothing |
| `KokoroTts` | Real local speech, on CPU (ADR-0010). **The default** (ADR-0050) | `kokoro-js`, installed separately |
| `ChatterboxTts` | A Chatterbox server of your own, such as a RunPod GPU pod: more expressive than Kokoro by ear, at its chosen slower pace. Slow for live play: about 4 s to first audio on an RTX 4090 ([spike](spikes/chatterbox.md)). `--tts chatterbox` (below) | A server (`spikes/chatterbox/run.sh`), `CHATTERBOX_URL` |
| `SpeechApiTts` | Any OpenAI-style `/v1/audio/speech` server. OpenAI's own model shuts down 2027-01-06 ([comparison](spikes/hosted-tts.md)). In the bench only | A key or a server |

Kokoro stays the default and a better voice is opt-in and chosen by ear: [ADR-0050](adr/0050-kokoro-stays-the-default-voice-others-are-opt-in-and-chosen-by-ear.md). How to judge a voice: [voice-rubric.md](voice-rubric.md). Any new adapter must set `AudioChunk.text` on a chunk that holds a whole piece, so `--phonemes` works.

## Installing Kokoro

```bash
make install-voice     # installs into .vikaki/voice and downloads the model; safe to run again
make doctor            # checks that everything the demos need is in place
```

`make demo-speech` runs `install-voice` for you. The voice lives in `.vikaki/voice`, outside the workspace, so everyone else keeps a small install. To use a copy installed elsewhere, set `VIKAKI_KOKORO_PATH` to its `kokoro.js`.

What `make install-voice` does by hand, for the curious:

```bash
cd .vikaki/voice && npm install kokoro-js --onnxruntime-node-install-cuda=skip
```

- The flag avoids an install error on machines where CUDA 11 is detected (this happens under WSL).
- About 410 MB installed. The first run downloads a model of about 330 MB (full-precision weights: three times faster to first audio than the 90 MB 8-bit ones on the machine measured, VIK-116; `VIKAKI_KOKORO_DTYPE=q8` or `fp16` picks another).
- Measured on a laptop CPU: roughly 0.75x real time, so a short first sentence takes about 1.6 s.
- To run the real-engine test: `VIKAKI_KOKORO_PATH=$PWD/.vikaki/voice/node_modules/kokoro-js/dist/kokoro.js pnpm --filter @vikaki/tts test`.

## Chatterbox (opt-in, VIK-146)

`vikaki serve --tts chatterbox` (or `VIKAKI_TTS=chatterbox`) speaks through a Chatterbox server you run yourself; Vikaki starts without calling it and says where it will speak. Settings, all from the environment:

| Variable | Meaning |
| --- | --- |
| `CHATTERBOX_URL` | The server's address up to `/v1`, such as `http://host:8000/v1` (required) |
| `CHATTERBOX_API_KEY` | The server's bearer key, if it wants one. Goes only into the `Authorization` header; never printed or put in an error |

What the adapter does: each sentence is cut into pieces of at most 200 characters and each piece is one request (Chatterbox does not stream inside a sentence), the next piece asked for while the last plays; one more try after a dropped connection, a time-out (a minute a piece) or an HTTP 429/5xx, never after a 4xx such as a wrong key; cancel stops the requests; each piece carries its words, so `--phonemes` and the mouth work. The pace is the one Jian chose by ear from three blind variants (VIK-150): every emotion's `exaggeration` 0.3 lower and `cfg_weight` at most 0.2, about 17% slower than Chatterbox's own and still expressive; `ChatterboxTts({ pace: null })` is Chatterbox's own, `pace: {...}` your own. Chatterbox puts an inaudible watermark in everything it makes (Resemble AI's Perth, always on). Running a server on a rented GPU, what it costs and the teardown: [spikes/chatterbox.md](spikes/chatterbox.md). The speech is slow to start (seconds, not Kokoro's under one), so it suits lines a game can prepare or wait for, not a quick back-and-forth. Kokoro stays the default ([ADR-0050](adr/0050-kokoro-stays-the-default-voice-others-are-opt-in-and-chosen-by-ear.md)).

## Where engines run

`KokoroTts` runs in a **worker thread** (ADR-0013). Synthesis holds its thread for up to 1.8 s at a time, and in the server's own thread that stalled everything the hub relays, including `speech_started` and `cancel`. Any engine can be run the same way with `WorkerTts.create({ module, options })`, where `module` is a JavaScript file exporting `create(options)`. Call `close()` to stop it; it lets work in progress finish first, because stopping Kokoro's native runtime mid-run can crash the process. `scripts/probe-hub-lag.ts [--in-process]` measures the difference with the real voice.

## Splitting text

`SentenceChunker` turns streamed text into pieces worth speaking so audio can start before a reply is finished. It splits at sentence ends (not at abbreviations like "Dr." or decimals like "3.5"), at CJK stops, and cuts a long sentence at a comma once it passes 80 characters, to start speaking sooner.

## How to tell speech from a test tone

Without the real voice the demos play a steady "aah" and the avatar holds one open mouth. The speech demo says so in a large amber banner. By ear or by eye: real speech has pauses and moving formants in a spectrogram, while the test tone is the same horizontal stripes throughout. Measured on a real clip against the test tone: loudness variation 0.5 against 0.06, and spectral wander of about 1,700 Hz against 8 Hz. `--debug-dir` records this for every utterance and a test gates on it: see docs/observability.md.

## Long sentences and cancelling

Kokoro cannot be interrupted part-way through a call, so a long sentence is made in pieces of about 70 characters, cut at punctuation where there is any, with the silence the engine pads each call with trimmed and a natural pause put back. A cancel then costs at most one piece (about 2 seconds of work) instead of the rest of the sentence. Details and measurements: [ADR-0013](adr/0013-tts-engines-run-in-a-worker-thread.md).

## Phonemes (VIK-50)

`vikaki serve --phonemes` (or `VIKAKI_PHONEMES=1`) sends the phonemes of what is said, with their times, on the audio; the avatar and table pages then drive the mouth from them (`?mouth=audio` opts out, [observability.md](observability.md)). The hub makes the phonemes itself, from the words of each piece of speech, with its own dictionary ([ADR-0049](adr/0049-our-own-grapheme-to-phoneme-from-the-cmu-dictionary.md): the CMU Pronouncing Dictionary, BSD-style licensed, and our code; no eSpeak). An engine says which words a chunk spoke with `AudioChunk.text` (Kokoro and the fake voice do: `--tts fake --phonemes`); it works for any engine, and for English only.

## eSpeak NG and the `vikaki-kokoro` image

Vikaki's own code has no eSpeak in it ([ADR-0049](adr/0049-our-own-grapheme-to-phoneme-from-the-cmu-dictionary.md)). `kokoro-js`, which the real voice needs, depends on the `phonemizer` package, which bundles **eSpeak NG (GPL-3.0-or-later)** compiled to WebAssembly, to turn text into the model's input. So Vikaki **publishes no image that contains Kokoro** ([ADR-0051](adr/0051-no-published-voice-image-and-kokoro-without-espeak-is-the-goal.md)): the release makes only the small `vikaki` image. `make install-voice` and `docker build --target vikaki-kokoro` still work, because that is you installing software on your own machine, not Vikaki distributing it. The goal is Kokoro on an eSpeak-free G2P (VIK-149), after which the image can be published again.
