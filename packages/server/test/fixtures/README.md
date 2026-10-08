# Fixtures

`kokoro-good-morning.wav`: "Good morning, everyone." spoken by Kokoro (voice `af_heart`), mono 16-bit, 24 kHz, 2.1 s. It is the golden real-speech clip for the speech-or-buzz gate.

Licence: Kokoro-82M and `kokoro-js` are Apache-2.0 (ADR-0010), so audio they generate may be committed. No third-party recording is involved.

Regenerate (needs `make install-voice`):

```bash
pnpm exec tsx scripts/make-speech-fixture.ts "Good morning, everyone." packages/server/test/fixtures/kokoro-good-morning.wav
```

A regenerated clip may differ slightly with the model version; the gate tests check ranges, not exact values.
