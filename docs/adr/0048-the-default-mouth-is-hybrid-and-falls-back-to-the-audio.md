# ADR-0048: The default mouth is hybrid: the phoneme's shape, the audio's loudness, and the audio mouth when there are no phonemes

- Status: Accepted (VIK-51)
- Date: 2026-10-25
- Deciders: Claude (default chosen by the scorecard; Jian may redirect)

## Context

VIK-50 (ADR-0047) puts the phonemes a voice spoke, with estimated times, on the page. The audio-driven mouth (wLipSync, ADR-0007) keeps up with the sound but does not know which vowel was said: on the scorecard it made the shape of the spoken vowel about a quarter of the time. VIK-51 builds a mouth from phonemes and compares three on the same eight lines ([observability.md](../observability.md)): `audio` (as before), `phoneme` and `hybrid`.

## Decision

- **Three mouths, one switch.** `?mouth=audio|phoneme|hybrid` on the avatar page and the table page. `PhonemeMouth` wraps the audio mouth, so the audio mouth is always there to fall back on.
  - `phoneme`: the shape and timing come from the phoneme track, eased between sounds (opening about 35 ms, closing about 50 ms), so one sound leans into the next. The sound's shape is in `phoneme-visemes.ts`: each vowel picks one of the five VRM shapes (aa, ih, ou, ee, oh), lips-together sounds (p, b, m) close the mouth, rounded and spread consonants are quiet versions of their shape, and stress makes a sound wider.
  - `hybrid`: the same shapes, with how far they open following the loudness of the audio now (a floor of a third of the opening, so a quiet syllable still shows).
  - `audio`: unchanged.
- **The default is `hybrid`, with a 60 ms lead and articulation 0.8.** It is the only mouth that is right when the phonemes are wrong or missing: when no phoneme is near (the hub was not started with `--phonemes`, the engine cannot say, or a line without them), it is the audio mouth exactly, so a page behaves as it did before unless the hub sends phonemes. With phonemes it makes the right vowel shape (90% of vowels against 23%), is steadier in time (the lag moves by 12 ms between runs against 34), shuts more often in the quiet (95% against 88%), and is as smooth. It follows the loudness a little less closely than the audio mouth (match at the best lag 0.70 against 0.76, inside run-to-run noise of about 0.03 to 0.05), which is the price of a mouth that shows the vowel.
- **Why hybrid and not phoneme.** The two scored alike on every number the scorecard has (the differences are inside the noise). Hybrid keeps a link to the sound that is actually playing: where the estimated phoneme times drift from the audio, the loudness still pulls the mouth in when the voice is quiet. That is a reason, not a measurement; the scorecard could not separate them.
- **Lead 60 ms.** Mouths shape a sound a little before it is heard. The phoneme mouths ran 85 ms behind the sound with no lead and 15 to 22 ms with 60 (the audio mouth runs 37 ms ahead of it in this headless setup, which has no real audio output clock; see the caveats). `?lead=` sets it in milliseconds.
- **Articulation 0.8** (`?articulation=`, 0 to 1). At 1 the strong vowels all reach full opening and stress stops showing; 0.8 keeps room for a stressed vowel to be wider than an unstressed one. Chosen by looking at the five vowel mouths on Cookieman ([phoneme-vowels.png](../img/phoneme-vowels.png)) and the stress arithmetic, not by the scorecard, which does not judge expressiveness.
- **wLipSync stays for the microphone**, where there is no text to take phonemes from.
- **The scorecard is still a report, not a gate.** Its new column, vowel shapes, is agreement with the phoneme track, so it is high for the phoneme mouths by construction; its worth is showing how far the audio mouth is from the spoken vowels. The track is itself an estimate.

## Rejected

- **`phoneme` as the default:** no better on the numbers, and it has nothing to hold it to the sound when timing is off.
- **`audio` as the default:** it ignores the vowels, which is what the whole of VIK-43 is to fix; and since `hybrid` is the audio mouth when there are no phonemes, there is no cost to the pages that have none.
- **A forced aligner or model for exact times:** out of scope here (ADR-0047). If better times come, the mouth does not change.

## Consequences

Turning on `--phonemes` changes the mouths on every page of that hub. `?mouth=audio` turns it off for a page. Real-ear and real-eye judgement of the result on a real call machine is still to be done by a person.
