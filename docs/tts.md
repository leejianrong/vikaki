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
- About 410 MB installed. The first run downloads a model of about 90 MB.
- Measured on a laptop CPU: roughly 0.75x real time, so a short first sentence takes about 1.6 s.
- To run the real-engine test: `VIKAKI_KOKORO_PATH=$PWD/.vikaki/voice/node_modules/kokoro-js/dist/kokoro.js pnpm --filter @vikaki/tts test`.

## Splitting text

`SentenceChunker` turns streamed text into pieces worth speaking so audio can start before a reply is finished. It splits at sentence ends (not at abbreviations like "Dr." or decimals like "3.5"), at CJK stops, and cuts a long sentence at a comma once it passes 80 characters, to start speaking sooner.

## How to tell speech from a test tone

Without the real voice the demos play a steady "aah" and the avatar holds one open mouth. The speech demo says so in a large amber banner. By ear or by eye: real speech has pauses and moving formants in a spectrogram, while the test tone is the same horizontal stripes throughout. Measured on a real clip against the test tone: loudness variation 0.5 against 0.06, and spectral wander of about 1,700 Hz against 8 Hz.
