# ADR-0051: No published voice image; Kokoro without eSpeak NG is the goal

- Status: Accepted (VIK-148)
- Date: 2026-10-30
- Deciders: Claude, on Jian's instruction to move away from eSpeak NG and GPL-3.0 and keep Vikaki Apache-2.0

## Context

[ADR-0049](0049-our-own-grapheme-to-phoneme-from-the-cmu-dictionary.md) took eSpeak NG out of Vikaki's own code. One place was left: `kokoro-js` depends on `phonemizer`, which bundles eSpeak NG (GPL-3.0-or-later) as WebAssembly, and the published `vikaki-kokoro` image (v0.1.0) contains it. Distributing that image distributes GPL code. The card's options were to ship GPL notices and a source pointer, stop publishing the image, or port misaki (Kokoro's own G2P, Apache-2.0).

## Decision

1. **Stop publishing `vikaki-kokoro`.** The release workflow builds, signs and pushes only the small `vikaki` image. The `vikaki-kokoro` Dockerfile target stays: building it yourself, like `make install-voice`, is you installing software on your own machine, not Vikaki distributing it. A test fails if `release.yml` mentions Kokoro again.
2. **The real fix is Kokoro without eSpeak** (VIK-149): feed Kokoro phonemes from an Apache-2.0-compatible G2P (our CMU-dictionary one from ADR-0049 mapped to Kokoro's symbol set, or a port of misaki), accepted only if it sounds as good by ear on the listening set ([voice-rubric.md](../voice-rubric.md)). Until then the voice image is not published.
3. Vikaki stays Apache-2.0. Nothing GPL is added to the workspace, the small image or the release.

## Why not the others

- **GPL notices and a source pointer** is legal but keeps GPL code in what we ship, which is what we are moving away from.
- **Port misaki now** is a large piece of work with unchecked dictionary licences, and the TTS direction (ADR-0050) is not settled. Dropping the image costs one build step for people who want the voice in a container.

## Consequences

- People who want Kokoro in a container build it (`docker build --target vikaki-kokoro .`); the docs say so.
- The already published `0.1.0-kokoro` tags still exist and still contain eSpeak NG. Removing them from GHCR is Jian's call (it is outward-facing and cannot be undone).
- If a released voice image is wanted before VIK-149, the first option above is the fallback.
