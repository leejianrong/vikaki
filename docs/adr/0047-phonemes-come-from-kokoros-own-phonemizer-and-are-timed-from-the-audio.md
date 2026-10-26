# ADR-0047: Phonemes come from Kokoro's own phonemizer, and are timed from the audio

- Status: Accepted (VIK-50). The "which phonemes" part is replaced by [ADR-0049](0049-our-own-grapheme-to-phoneme-from-the-cmu-dictionary.md) (our own dictionary G2P, no eSpeak); the timing part stands.
- Date: 2026-10-25
- Deciders: Claude (default chosen; Jian to confirm the licence stance)

## Context

The mouth follows the loudness and spectrum of the audio (wLipSync, ADR-0007). It keeps up with the sound but follows the loud syllables only loosely, and it has no idea which vowel was said (the scorecard, [observability.md](../observability.md)). The idea behind VIK-50 and VIK-51 is to drive the mouth from the phonemes the voice spoke instead, or from both. That needs two things: **which phonemes**, and **when**.

What the voice gives us, checked on the installed model (2026-10-25):

- The Kokoro ONNX model has inputs `input_ids`, `style`, `speed` and one output, `waveform`. **It returns no durations.** The phoneme timing has to be worked out from the audio.
- `kokoro-js` turns text into phonemes with the `phonemizer` package (`phonemizer.js`, Apache-2.0), which bundles **eSpeak NG compiled to WebAssembly**. eSpeak NG is **GPL-3.0-or-later**. It is already part of the optional Kokoro install: every user of the real voice already runs it.

## Decision

- **Which phonemes:** ask the same `phonemizer` that `kokoro-js` installs, from the same install directory, for the text of each piece Kokoro speaks (a few milliseconds a piece, after a 0.3 s first call made in the warm-up). The result is an IPA string. Nothing is added to the workspace or to what anyone installs; if the package cannot be found, the engine says nothing about phonemes and speech is as it was. Another engine (a hosted API) may supply its own phonemes later through the same `AudioChunk.phonemes` field; none does now.
- **When:** `alignPhonemes` (in `@vikaki/audio`, pure) gives each word time in proportion to how long its sounds usually take, pulls each word's edges to the nearest dip in loudness (the same `estimateWordTimings` the karaoke uses, now taking weights), and spreads the sounds through the word by their typical lengths (a long or stressed vowel longer, a stop shorter, a schwa shorter). It is an estimate, good to a few tens of milliseconds, not a forced alignment against a model. Phrase breaks and punctuation leave room for the pause.
- **How it travels:** `--phonemes` (or `VIKAKI_PHONEMES=1`) on `vikaki serve`. When on, the hub aligns each piece the engine says and puts the result on the first slice of that piece's audio (`audio.phonemes`: `p` IPA, `t` and `d` in ms from that slice's start, `s` stress). It is an additive, optional field, so pages and clients that do not know it ignore it, and with the flag off nothing is sent. The page keeps them in a `PhonemeTrack` on its own clock (`window.__vikaki.phonemes`).
- **eSpeak NG licence stance.** Vikaki's code stays Apache-2.0 and never contains, links or vendors eSpeak NG: it only calls the `phonemizer` package that the user's own optional `kokoro-js` install already brought, in the same way `kokoro-js` does. Nothing new is distributed by this repository for it. This is the same arrangement as Kokoro itself (ADR-0010), and unlike Piper, whose GPL code we would have had to depend on directly. **One consequence to know about:** the published `vikaki-kokoro` image (VIK-130) contains that install, and so contains eSpeak NG's GPL-3.0 code and data. Distributing it carries GPL obligations for that component (its licence text and a way to get its source). That is recorded in `docs/tts.md` and `packages/engine/ASSETS.md`; whether to ship the notices inside the image or drop that image is a decision for Jian.

## Rejected

- **Depend on eSpeak NG ourselves** (a package in the workspace, or a binary in the images): would make Vikaki distribute GPL code in its default install; the whole point of the optional install (ADR-0010) is to avoid that.
- **Write a grapheme-to-phoneme model:** large, and worse than the one Kokoro was trained against.
- **Timing from the model:** it does not output durations. A model that does (Kokoro through the PyTorch package, or another engine) can replace `alignPhonemes` behind the same field; the page does not change.
- **Phonemize in the page:** would ship the GPL data to every browser.
- **Always on:** the extra field is a few hundred bytes a piece, but the alignment and the phonemizer's memory are for pages that use them; off keeps the default path as it was.

## Consequences

VIK-51 builds the phoneme-to-viseme model and compares it with the audio-only mouth on the scorecard. The estimate's error is the ceiling on how good a phoneme-driven mouth can be; the comparison will say whether it is good enough.
