# ADR-0049: Our own grapheme-to-phoneme, over the CMU Pronouncing Dictionary; no eSpeak NG in Vikaki

- Status: Accepted (replaces the "which phonemes" part of ADR-0047)
- Date: 2026-10-26
- Deciders: Claude, on Jian's instruction to find something more permissive than GPL-3.0 or to write our own

## Context

ADR-0047 got the phonemes for the mouth from the `phonemizer` package that `kokoro-js` installs. That package bundles eSpeak NG, which is GPL-3.0-or-later. Vikaki never contained it, but the feature only worked with the real Kokoro voice, depended on that install, and made us reason about a GPL component. Jian does not want GPL in the picture and asked for a permissive phonemizer or our own.

The mouth needs the sound of each word, not exact IPA: five open shapes, a closed mouth, and which one a sound makes. Permissive options looked at (2026-10-25): misaki (Apache-2.0, Kokoro's own G2P, Python only, no JavaScript port, dictionary licences not stated), `@piper-plus/g2p` (MIT, rule-based, newer, no stress marks), g2p-en (Apache-2.0, Python). The CMU Pronouncing Dictionary is BSD-style licensed and is what g2p-en and misaki's English dictionaries are built on or beside.

## Decision

- **`ipaFor(text)` in `@vikaki/tts` (`g2p.ts`), Apache-2.0 code over the CMU Pronouncing Dictionary, with nothing else.** A word is looked up (126,052 words, stress marked); one the dictionary lacks is built from a known word and an ending ("bluffed", "plays", "dog's"), from two known words ("wavelength", "cardroom"), or by letter-to-sound rules (about 50 spelling patterns, the first vowel stressed), in that order. Numbers are said as words. The output is IPA in the shape `alignPhonemes` already takes, so nothing after it changed.
- **The data.** `packages/tts/data/cmudict.txt.gz`: one pronunciation a word, sorted, 0.87 MB, made by `scripts/make-cmudict.mjs` from a pinned commit of `cmusphinx/cmudict`. The licence is copied beside it (`CMUDICT-LICENSE`, 2 clauses plus an acknowledgement) and recorded in `ASSETS.md`. It is read once at hub start when `--phonemes` is on, and searched in place as one string (about 4 MB of memory, 0.4 microseconds a word), not loaded into a map.
- **Engine-agnostic.** An engine now says which words a chunk spoke (`AudioChunk.text`, on a chunk that holds a whole piece); the hub makes the phonemes. Kokoro does this (its piece text), the fake voice does (`pieces: true`), and any engine can, without knowing a phoneme. An engine that does know its own phonemes can still set `AudioChunk.phonemes`, which wins. Nothing in `kokoro-core` imports a phonemizer any more.
- **Timing is unchanged** (ADR-0047): estimated from the audio by `alignPhonemes`, since no engine returns durations.

## What it costs

Rare words, names and invented words are spelled by rule and will be wrong more often than eSpeak's. For the mouth that shows as a slightly different vowel in a word nobody will check; [observability.md](../observability.md) has the measured agreement with eSpeak and the scorecard run again on these phonemes. The dictionary is English only (American): a voice in another language gets phonemes that are wrong, not none; `--phonemes` is for English voices.

## What this does not change

The published `vikaki-kokoro` image still contains eSpeak NG, because `kokoro-js` itself needs it to turn text into the model's input. That is separate from this feature and was true before `--phonemes` existed. See [tts.md](../tts.md) for the notices and the options (ship the notices, stop publishing that image, or run Kokoro on an eSpeak-free G2P).

## Rejected

- **`@piper-plus/g2p`:** MIT and JavaScript, but a younger package, rule-based English with no stress in its example, and a WebAssembly dependency; our dictionary lookup is smaller than adopting it.
- **A port of misaki:** Kokoro's own G2P, and the real fix if Kokoro should not need eSpeak at all, but it is a large port with unstated dictionary licences; a separate decision.
- **A full letter-to-sound model:** the dictionary covers over 97% of the words in ordinary prose; rules for the rest only need to be plausible.
