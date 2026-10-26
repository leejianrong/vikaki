# ADR-0050: Kokoro stays the default voice; a better voice is opt-in and chosen by ear

- Status: Proposed (VIK-145): the facts below are measured or researched, but **nobody has scored the voices by ear yet**, and the choice of a second voice is Jian's. Accept it, or send it back with the listening scores.
- Date: 2026-10-27
- Deciders: Claude (recommendation); Jian to decide

## Context

Jian is not satisfied with Kokoro's voice quality (VIK-E12). Three things were done: a way to judge voices ([voice-rubric.md](../voice-rubric.md), ten lines, blind clips, first-audio and speed numbers, Kokoro baseline: 0.86 s to first audio, 3.1x real time on a laptop CPU, VIK-142); Chatterbox self-hosted on a rented RTX 4090 ([spikes/chatterbox.md](../spikes/chatterbox.md), VIK-143); and the hosted APIs compared on paper ([spikes/hosted-tts.md](../spikes/hosted-tts.md), VIK-144, no audio rendered).

What was found:

- **Chatterbox is too slow to be the live voice.** 4.0 s to first audio on average and 0.77x real time on a 4090 (a one-word line took 2.4 s: each request costs about two seconds before any audio), against a target of about one second (ADR-0010, VIK-116). It does not stream inside a line. It costs $0.89 an hour, a 4-minute cold start, and a pod to start and stop. Licence is MIT, with an always-on watermark. Faster forks and half precision are untried.
- **OpenAI's `gpt-4o-mini-tts` shuts down on 2027-01-06**, and its replacement is not on the endpoint our adapter uses.
- **Hosted candidates** (Cartesia Sonic 3.6, ElevenLabs Flash/Turbo, Inworld) claim 75 to 100 ms to first audio and cost 8 to 41 cents a 20-hand game, but each has its own API (a new adapter each), sends every spoken line to a third party, and needs a key. Their quality is unscored.
- **Whether any of them sounds better than Kokoro is unknown.** The rubric needs a person listening.

## Decision

- **Kokoro stays the default**, and the only engine that needs no key, no network and no money. It is the fallback when another voice is down (the hub already reports `tts_failed`).
- **A second voice is opt-in** (`--tts <name>`, a key from an environment variable, never logged) and never the default for a user who has not asked for it. Nothing is wired into `vikaki serve` until a voice has won by ear.
- **Chatterbox stays an optional adapter, not a recommendation for live play.** `ChatterboxTts` stays (tested against a fake server, sets `AudioChunk.text`), and `spikes/chatterbox/run.sh` stays as the way to measure it. It suits lines made ahead of time, not a table that talks as it plays, until a faster setup is shown to beat about 1 s.
- **Do not build on OpenAI's TTS.** Remove `PROVIDERS.openai()` when the model shuts down (or sooner).
- **The next step is a listen, not code:** run the ten lines blind through Cartesia Sonic 3.6 and ElevenLabs Flash or v4 Turbo with Jian's own keys (about 669 characters each: a fraction of a cent to about five cents a provider), score by the rubric, and compare with Kokoro and the Chatterbox clips already made. Whichever clearly wins gets a production adapter and `--tts <name>` (a new card).

## Alternatives considered

| Option | Why not now |
| --- | --- |
| Make Chatterbox the default | Latency 4x the target and a pod to manage; not offline |
| Make a hosted API the default | Every line leaves the machine and costs money, a key is needed, quality unscored |
| Replace Kokoro | It is free, offline, fast and deterministic enough; the complaint is quality, which is not yet shown to be better elsewhere |
| Tune Kokoro (other voices, speed) | Not a decision; VIK-147 covers CPU speed. Voice choice can be tried with `af_*`/`bf_*` ids in the bench for nothing |
| Wire a hosted engine now and decide later | Adapters for providers that may lose, and a deprecated one in `--tts` |

## Consequences

Buys no change for anyone using Kokoro today, and a clear route to a better voice: one listening session with two keys. Costs the wait: until someone listens, the question "is a better voice available" has an answer on speed and price but not on sound. If the listening finds a clear winner, a new ADR supersedes the "opt-in" line for that engine, and `docs/tts.md` gains its row.

## Revisit when

- A listening session scores a voice well above Kokoro (a new ADR and card).
- Chatterbox (or a fork) reaches about 1 s to first audio at 1x or better on a rented GPU, or a long enough run keeps a pod cheaply busy.
- Kokoro gets a better English voice or an eSpeak-free build (VIK-147, VIK-148).
