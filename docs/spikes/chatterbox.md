# Spike: Chatterbox on a RunPod GPU (VIK-143)

Question: is Chatterbox, self-hosted on a rented GPU, a better voice than Kokoro, and what does it cost in latency, money and effort? Measured 2026-10-27 with the ten-line set of [voice-rubric.md](../voice-rubric.md). **The quality scores are not in this write-up: they need a person listening** (the blind clips are for Jian, see "To score" below). Everything else is measured.

## Short answer

- **Latency is the problem.** Plain Chatterbox on an RTX 4090 took **4.0 s on average to the first audio** (2.4 to 5.8 s) and made speech at **0.77x real time** (slower than it plays). Kokoro on this laptop's CPU: 0.86 s and 3.1x. The one-word "Fold." took 2.4 to 2.7 s for 0.8 s of audio, so each request has a fixed cost of about two seconds, and short lines are the worst case; the 224-character line ran at 1.2x. The hub aims for about a second to first audio.
- **It does not stream inside a line.** Chatterbox returns a whole sentence at once. The adapter streams the way Kokoro's does, a piece at a time, so first audio is the time to make the first piece.
- **Money is small**: $0.89 an hour (secure cloud, RTX 4090). About 2 cents per minute of speech if the GPU is kept busy (1 / 0.77 of a minute of GPU per minute of speech); a pod that sits up between lines costs by the hour, not the line. A 20-hand game (5.7 minutes of audio, 14 minutes long) is about 20 cents of pod plus a 4-minute cold start.
- **Licence is fine**: code and weights MIT. Every clip carries Resemble's Perth implicit watermark; `generate()` has no switch to turn it off.
- Whether it *sounds* better, and whether emotion control earns the wait, is Jian's call by ear.

## What was built

| What | Where |
| --- | --- |
| `ChatterboxTts` (a `Tts`), `chatterboxParams(emotion, thought)` | `packages/tts/src/chatterbox-tts.ts` |
| The pod's server: OpenAI-style `POST /v1/audio/speech` over Chatterbox, `--fake` for a CPU rehearsal | `spikes/chatterbox/server.py` |
| The run: rent, wait, bench, tear down | `spikes/chatterbox/run.sh`, `job.sh.tmpl` |
| `SynthesisRequest.emotion` (additive), `SpeechApiOptions.bodyFor` | `packages/tts/src/types.ts`, `speech-api-tts.ts` |

The adapter cuts a long sentence into pieces of at most 200 characters (`splitLong`, as Kokoro does), asks for each, asks for the next while the last one plays, and yields each piece as one chunk **with `AudioChunk.text` set**, so `--phonemes` works (ADR-0049). The emotion goes as two numbers: Chatterbox's `exaggeration` and `cfg_weight` (starting values in `chatterboxParams`, from Chatterbox's own advice, not yet tuned by ear). It does not read words, so the free-text `style` is ignored. Tests use a fake `fetch` only; the key is in the Authorization header, never in a body, and an error that echoes it is scrubbed.

Not wired into `vikaki serve` (`--tts chatterbox`): that waits for the decision (VIK-145).

## Numbers

Pod: RTX 4090 (24 GB), secure cloud, on demand, image `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`, `chatterbox-tts` 0.1.7 with torch 2.6.0 and transformers 5.2.0. Timed from this laptop through RunPod's HTTPS proxy, so first audio includes the network (a few hundred milliseconds at most). One untimed warm-up line first. Raw data: [run 1](chatterbox-results-run1.json), [run 2](chatterbox-results-run2.json), Kokoro from [voice-baseline.md](voice-baseline.md).

| Line | Chars | Chatterbox first audio (run 1 / 2) | Audio | Chatterbox speed | Kokoro first audio | Kokoro speed |
| --- | --- | --- | --- | --- | --- | --- |
| short ack | 5 | 2366 / 2723 ms | 0.8 s | 0.3x | 417 ms | 3.4x |
| taunt | 53 | 3724 / 3916 ms | 2.6 s | 0.7x | 729 ms | 2.7x |
| numbers | 72 | 5823 / 5025 ms | 6.7 s | 1.1x | 1947 ms | 2.9x |
| names | 73 | 4126 / 5237 ms | 3.9 s | 1.0x | 910 ms | 3.2x |
| worried thought | 44 | 3643 / 3603 ms | 2.5 s | 0.7x | 810 ms | 3.0x |
| excited rush | 23 | 3359 / 3145 ms | 2.1 s | 0.6x | 611 ms | 3.6x |
| sad bust-out | 58 | 4393 / 3803 ms | 3.0 s | 0.7x | 1009 ms | 3.2x |
| angry fold | 52 | 3655 / 3679 ms | 2.3 s | 0.6x | 729 ms | 3.0x |
| question | 65 | 3506 / 3524 ms | 2.7 s | 0.8x | 702 ms | 3.4x |
| long story | 224 | 5329 / 5821 ms | 8.4 s | 1.2x | 684 ms | 3.2x |
| **mean** | | **3992 / 4048 ms** | 3.5 s | **0.77x** | 855 ms | 3.1x |

The two runs agree within noise (mean 3992 and 4048 ms; 35.0 and 35.3 s of audio in 41.5 and 42.1 s of work). The long line has two chunks (pieces), every other line one.

- **Cold start: 232 s** from asking for the pod to the first healthy answer: the image pull and container start, 147 s of `pip install` (torch 2.6.0 over the image's 2.4.0, and Chatterbox's dependencies), and 60 s to download the 3 GB model, load it and run a warm-up sentence. A pod with a network volume or an image with these baked in would cut most of that; not tried.
- **Streaming:** none inside a piece (above). With one-piece-ahead prefetch a long line is gap-free only if speed stays above 1x, and it does not for ordinary lines (0.6 to 0.8x), so expect pauses between pieces of a long reply.
- **Cost:** $0.89 an hour measured (the cap in `run.sh` is $1.00). The community cloud price for a 4090 is $0.34 an hour but had no stock when tried. The three pods of this spike (two attempts that failed to start, below, and the measured one) cost about $0.22 in all.
- **Likely speed-ups, not tried:** a faster fork (vLLM-based or streaming ones exist; their licences and quality are unchecked), half precision, `torch.compile`, a larger GPU (the work looks bound by token-by-token sampling, 17 to 30 steps a second in the log, rather than by GPU size).

## Licence and watermark

Code: MIT (`chatterbox-tts` on PyPI). Weights: `ResembleAI/chatterbox` on Hugging Face, card says MIT, not gated, downloaded without a token. Every output is watermarked with Perth (the log says `loaded PerthNet (Implicit)`); it is meant to be inaudible and `ChatterboxTTS.generate()` offers no way to turn it off. Voice cloning from a sample is supported by the model and was not used.

## What went wrong on the way (for the next person)

All three cost under ten cents because the run is built to be stopped early:

1. **An image with no `curl` or `wget`** (`pytorch/pytorch`): `rp` could not install `runpodctl` on the pod, so the pod's own self-terminate would not have worked. The log said so; I stopped and tore down. `run.sh` now stops if the pod says `no runpodctl`, and uses RunPod's own image.
2. **`torchvision::nms does not exist`**: the image's torchvision is built for torch 2.4 and Chatterbox installs torch 2.6.0. Fixed by uninstalling torchvision (Chatterbox does not use it).
3. **`PerthImplicitWatermarker` is `None`** (found in a CPU rehearsal before the third pod): the watermark package needs `pkg_resources`, which setuptools 81 removed. Fixed with `setuptools<81`.
4. A one-word warm-up ("Ready.") ran Chatterbox's sampler to its 1000-token limit on CPU; use a sentence. (On the GPU "Fold." was fine: 0.8 s of audio.)

Rehearse the pod's code path on a CPU first (a venv with the same pins, then `server.py` with the real model): it found the third bug for free.

## To run it again

```bash
cp .env.example .env     # RUNPOD_API_KEY=...
spikes/chatterbox/run.sh # about 6 minutes and 10 cents; RP_CLOUD_TYPE=COMMUNITY for the cheaper cloud when it has stock
```

It reads the key from `.env` by name (never printed), makes a one-off token for the server, patches a copy of `rp` to open an HTTP port, traps every exit to terminate the pod, and ends by listing the account's pods (it must print `[]`). Set an account spend limit in the RunPod console as well. Output lands in `.vikaki/voice-eval/chatterbox/`.

## To score

The clips are in `.vikaki/voice-eval/` (not committed; it is local): `kokoro/` (named by line, from the baseline run) and `chatterbox/blind/` (`A01.wav`..., shuffled; `key.json` says which line each is, so do not open it until you have scored them). Score each by [the rubric](../voice-rubric.md) and compare line by line.

This pass is **not blind across engines**: the Kokoro clips are named. A blind comparison needs both engines in one run (`--engines kokoro,chatterbox --blind`), which needs a pod up for the Chatterbox half; do that run if the ADR (VIK-145) is close.

## Pace (VIK-150)

Jian's first listen: Chatterbox is more expressive than Kokoro but sounds as if it is spoken at 1.5x to 2x. Chatterbox has no speed setting. Its two numbers pull on pace: a high `exaggeration` speeds speech up and a lower `cfg_weight` slows it. `ChatterboxOptions.pace` (`exaggerationDelta`, `cfgWeightCap`) and `CHATTERBOX_PACE="-0.15,0.3"` in the bench now turn both down for every emotion; unset is as before.

One pod (RTX 4090, secure cloud, $0.89/h, 325 s of pod time, about $0.08; `pod list` empty after) ran the ten lines three times, each blind inside (`A01`..) and under neutral names `V1`..`V3` (`spikes/chatterbox/run.sh`, `PACES`), clips in `.vikaki/voice-eval/chatterbox-pace/`.

**Spoiler, open after listening:** `variants-key.json` there says V1 = as before, V2 = `-0.15,0.3`, V3 = `-0.3,0.2`. Total audio for the ten lines: V1 35.4 s, V2 36.2 s (+2%), V3 41.4 s (+17%). Mean first audio about 4.1 to 4.8 s in each (settings do not change speed of generation). Raw results: `chatterbox-pace-V*.json`.

What this says before anyone has scored it: these two knobs slow the speech by at most about 17%, not the 25% to 50% that "1.5x to 2x" would need to be undone. If V3 still sounds too fast, the settings cannot fix it. The remaining levers are a slower reference voice (Chatterbox copies the pace of its reference clip; a clip needs its licence recorded first) and a pitch-preserving time stretch of about 0.8x on each piece, which Jian chose not to test yet.
