# ADR-0010: Kokoro for local text-to-speech, as an optional on-demand engine

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian, Claude (checked in slice V2.3)

## Context

Slice V2 needs a local text-to-speech engine behind the `Tts` interface (R6: nothing leaves the machine, R8: tests need no models). The plan flagged licences to check first, because Piper's current repository is GPL.

## Decision

Use **Kokoro** (`kokoro-js`, code Apache-2.0; model Kokoro-82M, Apache-2.0), run on CPU through ONNX, as the first local engine. It is loaded with a dynamic import and is not a dependency of the workspace, so the core install, CI and tests stay small. The engine is chosen at run time; tests use `FakeTts`.

Measured on this development machine (CPU, q8 weights, 24 kHz voice `af_heart`): model load 22 s the first time including the download, then about 0.75x real time (1.6 s to speak a 2.1 s sentence, 2.5 s for 3.3 s). So a short first sentence takes roughly 1.6 s to produce, which misses the one-second target in R3. Cutting the first chunk at a clause (`SentenceChunker`) is the main lever; the real number is reported by slice V2.7.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Piper | The maintained repository (`OHF-Voice/piper1-gpl`) is GPL-3.0. The earlier MIT repository is archived |
| espeak-ng | GPL-3.0, and robotic |
| The browser's `speechSynthesis` | Its audio cannot be captured, so lip sync could not follow it |
| A hosted engine (ElevenLabs, Cartesia, OpenAI) | Audio and text leave the machine, and it needs keys. Still allowed later behind the same interface |
| Bundle kokoro-js as a normal dependency | About 410 MB with its runtime, plus a model download, for every user and every CI run |

## Consequences

Buys a permissive licence and fully local speech with 28 voices. Costs a large optional install, a model download on first use, and latency above the target on a CPU. `onnxruntime-node` fails to install on machines where it detects CUDA 11 (seen under WSL), which needs `--onnxruntime-node-install-cuda=skip`; the install hint says so. A GPU or a smaller model could close the latency gap, and a hosted engine is the escape hatch.
