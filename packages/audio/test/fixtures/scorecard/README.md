# Lip-sync scorecard recordings

Eight short lines of speech by Kokoro, mono 16-bit WAV at 24 kHz, 1.1 MB in all. `scripts/lipsync-scorecard.ts` plays them through the page and scores the mouth (`docs/observability.md`, VIK-49). They have no padding: the script adds quiet either side.

| File | Voice | Says |
| --- | --- | --- |
| `line-1.wav` | `af_heart` | Good morning, everyone. Shall we begin? |
| `line-2.wav` | `am_adam` | Hmm, I will call that bet. |
| `line-3.wav` | `bf_emma` | That is too rich for me. I fold! |
| `line-4.wav` | `af_heart` | Is she bluffing? I really cannot tell. |
| `line-5.wav` | `am_adam` | Two sevens and an ace. Lovely. |
| `line-6.wav` | `bf_emma` | Oh no. Well played, Ada. |
| `line-7.wav` | `af_heart` | Let me think about it for a moment. |
| `line-8.wav` | `am_adam` | Boom! Three of a kind. Thank you for the chips. |

Licence: Kokoro-82M and `kokoro-js` are Apache-2.0 (ADR-0010), so audio they generate may be committed. No third-party recording is involved.

Regenerate one (needs `make install-voice`), for example line 2:

```bash
pnpm exec tsx scripts/make-speech-fixture.ts "Hmm, I will call that bet." packages/audio/test/fixtures/scorecard/line-2.wav am_adam
```

Each `line-N.txt` is the line's words, which the phoneme mouths turn into phonemes with the dictionary in `@vikaki/tts` (ADR-0049). A regenerated clip may differ slightly with the model version, and the baseline in `docs/observability.md` was taken on these files, so record the lines again after changing them.
