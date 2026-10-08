# Bundled third-party assets

Record the licence here before committing any asset.

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/avatars/teddy.vrm` | "Teddy" avatar, 100Avatars R1 #011, VRM 0.x | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1` | CC0 (declared in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`) |

The VRM has the five vowel blendshapes `a e i o u` and `blink`, which three-vrm exposes as `aa ih ou ee oh blink`.

## Lip-sync profile

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/profiles/default.bin` | wLipSync binary profile (MFCC reference data for A, I, U, E, O) | [mrxz/wLipSync](https://github.com/mrxz/wLipSync) `example/profile.bin`, a calibration in the format of [uLipSync](https://github.com/hecomi/uLipSync) | MIT (both projects) |

It was calibrated on someone else's voice. It held up across two TTS voices in the V1.3 spike (`docs/spikes/lipsync.md`), but a user's own voice may match worse, and we cannot make new profiles without Unity yet.
