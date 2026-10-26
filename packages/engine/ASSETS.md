# Bundled third-party assets

Record the licence here before committing any asset.

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/avatars/cookieman.vrm` | "Cookieman" gingerbread avatar, 100Avatars R1 #098, VRM 0.x. Default avatar | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1` | CC0 (declared in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`) |
| `public/avatars/snowy.vrm` | "Snowy" snowman avatar, 100Avatars R1 #097 (author Polygonal Mind), VRM 0.x. The second persona look (ben) | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1`, file `097_Snowy.vrm` | CC0 (declared for `100avatars-r1` in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`). Downloaded 2026-10-08, 1.6 MB; has the five vowel blendshapes `a e i o u` and `blink` |
| `public/avatars/cactusboy.vrm` | "CactusBoy" avatar, 100Avatars R1 #009, VRM 0.x, 1.8 MB; has the five vowel blendshapes and `blink`. Cy, the third seat (VIK-85). Chosen from a contact sheet by Jian | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1`, avatar #009 | CC0 (declared for `100avatars-r1` in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`). Downloaded 2026-10-18 |
| `public/avatars/froggy.vrm` | "Froggy" avatar, 100Avatars R1 #010, VRM 0.x, 1.8 MB; has the five vowel blendshapes and `blink`. Not seated yet: for a table of 6 or more (VIK-88). Chosen from a contact sheet by Jian | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1`, avatar #010 | CC0 (declared for `100avatars-r1` in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`). Downloaded 2026-10-18 |
| `public/avatars/lilbro.vrm` | "LilBro" avatar, 100Avatars R1 #071, VRM 0.x, 1.4 MB; has the five vowel blendshapes and `blink`. Not seated yet: for a table of 6 or more (VIK-88). Chosen from a contact sheet by Jian | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1`, avatar #071 | CC0 (declared for `100avatars-r1` in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`). Downloaded 2026-10-18 |
| `public/avatars/mushy.vrm` | "Mushy" avatar, 100Avatars R1 #025, VRM 0.x, 1.3 MB; has the five vowel blendshapes and `blink`. Not seated yet: for a table of 6 or more (VIK-88). Chosen from a contact sheet by Jian | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1`, avatar #025 | CC0 (declared for `100avatars-r1` in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`). Downloaded 2026-10-18 |
| `public/avatars/wambo.vrm` | "Wambo" avatar, 100Avatars R1 #020, VRM 0.x, 1.6 MB; has the five vowel blendshapes and `blink`. Not seated yet: for a table of 6 or more (VIK-88). Chosen from a contact sheet by Jian | [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars), collection `100avatars-r1`, avatar #020 | CC0 (declared for `100avatars-r1` in the registry's `projects.json` and embedded in the VRM's own metadata: licenseName `CC0`, allowedUser `Everyone`, commercial `Allow`). Downloaded 2026-10-18 |

The first two VRMs have the five vowel blendshapes `a e i o u` and `blink`, which three-vrm exposes as `aa ih ou ee oh blink`.

## Card art

The `?cards=classic` deck (VIK-115) is drawn in code (`src/card-art.ts`: index corners, pips in their traditional places, framed court cards with a crown or cap) and uses no third-party artwork or font, so nothing here needs a licence. A deck made from someone's artwork (an open-source vector deck, say) would be recorded in the table above before it was committed.

## Lip-sync profile

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/profiles/default.bin` | wLipSync binary profile (MFCC reference data for A, I, U, E, O) | [mrxz/wLipSync](https://github.com/mrxz/wLipSync) `example/profile.bin`, a calibration in the format of [uLipSync](https://github.com/hecomi/uLipSync) | MIT (both projects) |

It was calibrated on someone else's voice. It held up across two TTS voices in the V1.3 spike (`docs/spikes/lipsync.md`), but a user's own voice may match worse, and we cannot make new profiles without Unity yet.

## Choosing avatars

Judge avatars by screenshot, not by name. "Teddy" (#011) was the first default and read as fierce: its angry brows are baked into the mesh and texture, and none of its 16 morph targets removes them, so no expression fix is possible. Cookieman, Snowy (#097), Milk (#084) and the mushroom kid Muscary (#076) all looked friendly in the same comparison. All are CC0 with the five vowel shapes and blink. Eye level is estimated for avatars without eye bones, so framing may need a per-avatar tweak for non-humanoid shapes (Coffee #080 and Good Tomato #082 fill the frame).

## Interface font

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/fonts/Fredoka.ttf` | Fredoka variable font (weight and width axes), used for headings and numbers in the demo pages | [google/fonts](https://github.com/google/fonts/tree/main/ofl/fredoka) | SIL Open Font License 1.1 (`public/fonts/Fredoka-OFL.txt`) |

`@material/web` (Apache-2.0) and `@material/material-color-utilities` (Apache-2.0, dev only, used to generate `src/ui/theme.css`) are ordinary dependencies.

The seated pose (ADR-0019) is tuned per avatar: Cookieman and Snowy have numbers, CactusBoy uses the defaults after a look from the side (`?cam=`), and Froggy, LilBro, Mushy and Wambo have not been seated yet: judge each from the side before putting it at the table.

## Pronunciation dictionary (committed)

| File | Where it comes from | Licence | Note |
| --- | --- | --- | --- |
| `packages/tts/data/cmudict.txt.gz` | The CMU Pronouncing Dictionary, `cmudict.dict` at commit `74790861` of github.com/cmusphinx/cmudict, reduced by `scripts/make-cmudict.mjs` (first pronunciation of each word) | BSD-style (Carnegie Mellon University, 1993-2015): redistribution with the notice and disclaimer, kept in `packages/tts/data/CMUDICT-LICENSE` | Used by `ipaFor` (ADR-0049) for `--phonemes`. 126,052 words, 0.87 MB. |

## Voice runtime components (not committed, installed on demand)

| Component | Where it comes from | Licence | Note |
| --- | --- | --- | --- |
| `kokoro-js` and the Kokoro-82M model | `make install-voice`, the `vikaki-kokoro` image | Apache-2.0 | ADR-0010 |
| `phonemizer` (wrapper) with eSpeak NG compiled to WebAssembly | a dependency of `kokoro-js`, used by it to make the model's input | wrapper Apache-2.0; **eSpeak NG GPL-3.0-or-later** | Not used by Vikaki's own code (ADR-0049). Part of the optional Kokoro install, never in the workspace. The `vikaki-kokoro` image therefore redistributes eSpeak NG under the GPL-3.0: see docs/tts.md. |
