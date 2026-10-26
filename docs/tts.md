# Text to speech

Vikaki speaks through a `Tts` interface (`packages/tts`). Engines yield audio as it is produced.

| Engine | Use | Needs |
| --- | --- | --- |
| `FakeTts` | Tests and development. Deterministic "aah" audio, timing you can predict | Nothing |
| `KokoroTts` | Real local speech, on CPU (ADR-0010) | `kokoro-js`, installed separately |

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

## eSpeak NG in the `vikaki-kokoro` image

Our phoneme feature has no eSpeak in it. But `kokoro-js`, which the real voice needs, depends on the `phonemizer` package, which bundles **eSpeak NG (GPL-3.0-or-later)** compiled to WebAssembly, to turn text into the model's input. It comes with every Kokoro install, including the published `vikaki-kokoro` image, so distributing that image distributes eSpeak NG under the GPL-3.0 (licence text and source: https://github.com/espeak-ng/espeak-ng). Vikaki's own code and every other image stay free of it. Options for that image: ship the GPL notices and a source pointer, stop publishing it (users install the voice themselves), or run Kokoro on an eSpeak-free G2P such as a port of misaki (Apache-2.0).
