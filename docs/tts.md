# Text to speech

Vikaki speaks through a `Tts` interface (`packages/tts`). Engines yield audio as it is produced.

| Engine | Use | Needs |
| --- | --- | --- |
| `FakeTts` | Tests and development. Deterministic "aah" audio, timing you can predict | Nothing |
| `KokoroTts` | Real local speech, on CPU (ADR-0010) | `kokoro-js`, installed separately |

## Installing Kokoro

```bash
npm install kokoro-js --onnxruntime-node-install-cuda=skip
```

- The flag avoids an install error on machines where CUDA 11 is detected (this happens under WSL).
- About 410 MB installed. The first run downloads a model of about 90 MB.
- Measured on a laptop CPU: roughly 0.75x real time, so a short first sentence takes about 1.6 s.
- To run the real-engine test: `VIKAKI_KOKORO_PATH=<path to node_modules/kokoro-js/dist/kokoro.js> pnpm --filter @vikaki/tts test`.

## Splitting text

`SentenceChunker` turns streamed text into pieces worth speaking so audio can start before a reply is finished. It splits at sentence ends (not at abbreviations like "Dr." or decimals like "3.5"), at CJK stops, and cuts a long sentence at a comma once it passes 80 characters, to start speaking sooner.
