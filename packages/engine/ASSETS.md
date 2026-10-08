# Bundled third-party assets

Record the licence here before committing any asset.

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/avatars/cookieman.vrm` | "Cookieman" gingerbread avatar, 100Avatars R1 #098, VRM 0.x. Default avatar | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1` | CC0 (declared in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`) |

The VRM has the five vowel blendshapes `a e i o u` and `blink`, which three-vrm exposes as `aa ih ou ee oh blink`.

## Lip-sync profile

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/profiles/default.bin` | wLipSync binary profile (MFCC reference data for A, I, U, E, O) | [mrxz/wLipSync](https://github.com/mrxz/wLipSync) `example/profile.bin`, a calibration in the format of [uLipSync](https://github.com/hecomi/uLipSync) | MIT (both projects) |

It was calibrated on someone else's voice. It held up across two TTS voices in the V1.3 spike (`docs/spikes/lipsync.md`), but a user's own voice may match worse, and we cannot make new profiles without Unity yet.

## Choosing avatars

Judge avatars by screenshot, not by name. "Teddy" (#011) was the first default and read as fierce: its angry brows are baked into the mesh and texture, and none of its 16 morph targets removes them, so no expression fix is possible. Cookieman, Snowy (#097), Milk (#084) and the mushroom kid Muscary (#076) all looked friendly in the same comparison. All are CC0 with the five vowel shapes and blink. Eye level is estimated for avatars without eye bones, so framing may need a per-avatar tweak for non-humanoid shapes (Coffee #080 and Good Tomato #082 fill the frame).
