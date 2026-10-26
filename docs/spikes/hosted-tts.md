# Spike: hosted TTS APIs (VIK-144)

Question: would a third-party speech API beat Kokoro (and self-hosted Chatterbox, [chatterbox.md](chatterbox.md)) on quality, latency, price and terms? **Desk research only, 2026-10-27.** Jian chose not to spend on API calls and no provider keys were set up, so **no audio was rendered and nothing here is a quality score**: quality needs the listening set ([voice-rubric.md](../voice-rubric.md)) run through each engine with Jian's own key. Prices and claims come from the vendors' own pages where I could open them; where I could only find third-party pages it says so. Prices move: re-check before deciding.

## Short answer

1. **OpenAI's `gpt-4o-mini-tts` is going away.** OpenAI's text-to-speech guide says `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts` "are deprecated and will shut down on January 6, 2027"; the replacement `gpt-realtime-2.1-mini` is on the Realtime API and "isn't a supported model for /v1/audio/speech". `PROVIDERS.openai()` (VIK-140) and `docs/tts-providers.md` point at the model that is ending. Drop it from the candidates.
2. **Two hosted candidates are worth a listen: Cartesia Sonic 3.6 (lowest latency claim, cheapest of the well-known pair, cloning from the $5 plan) and ElevenLabs (most expressive by reputation, dearest, audio tags for emotion).** Inworld TTS-2 is the cheap third and the least known to me.
3. **None is OpenAI-shaped.** `SpeechApiTts` speaks `POST /v1/audio/speech`; ElevenLabs, Cartesia and Inworld each have their own HTTP or WebSocket streaming API, so each needs its own adapter (about a day each, with the fake-`fetch` tests used for Chatterbox).
4. **At this table's volume price barely matters**: a 20-hand game is about 5,200 characters (5.7 minutes), so it costs 8 to 41 cents on any of them. Latency, voice quality and terms decide.

## The table

Per-game cost is for the measured 20-hand game: 5,168 characters, 5.7 minutes of audio ([tts-providers.md](../tts-providers.md)). "Claim" means the vendor said it; none of it was measured here.

| | ElevenLabs | Cartesia | Inworld | Hume Octave 2 | OpenAI |
| --- | --- | --- | --- | --- | --- |
| Model | v4 / v4 Turbo / v3 / Multilingual v2 / Flash v2.5 | Sonic 3.6 (`sonic-3.6`) | TTS-2, TTS-2 Flash | Octave 2 (preview) | gpt-4o-mini-tts (**ends 2027-01-06**) |
| List price, per 1M characters | $80 (v3, Multilingual v2); $40 (Flash, Turbo) | Overage $65 (Pro), $45, $38; plans work out to about $50, $39, $37 | $25 (TTS-2), $15 (Flash) on demand; down to $20/$10 at $25 a month | Sources disagree ($7.60 to $75); not confirmed on Hume's page | About $15 (a minute is "an estimate") |
| One 20-hand game | $0.41 (v3) / $0.21 (Flash) | about $0.26 to $0.34 | $0.13 (TTS-2) / $0.08 (Flash) | $0.04 to $0.39 (unverified) | about $0.09 |
| Free tier | 10,000 characters a month (page unlabelled) | 20,000 credits (about 27 minutes), **no commercial licence**, 2 concurrent | 70 minutes of TTS on the pay-as-you-go plan, commercial licence included | About 10,000 characters a month (third parties) | None |
| First-audio claim | Flash about 75 ms, v4 Turbo about 100 ms, v3 Conversational about 280 ms (model only, not network) | "Fastest"; third parties say under 90 ms, Turbo about 40 ms; **Cartesia's own page gives no figure** | "Real time"; no figure on the page | About 100 ms, not counting the network (Hume docs, preview) | Not stated |
| Emotion control | Audio tags on v4 Turbo and v3 Conversational; the text and punctuation cue the rest | Pacing follows the text's emotional context, no tags; speed and volume settings | "Steering" on TTS-2 only; speaking rate, temperature | Natural-language acting instructions and voice design (not confirmed for Octave 2 in the docs I could open) | Free-text `instructions` (works today) |
| Streaming | Yes (Flash page says streaming requests are supported) | Yes (SSE, WebSocket, bytes: not on the page I could open) | Realtime | Yes | Yes, on the old endpoint |
| Cloning | Cloned voices usable by ID; plan terms not on the page | Instant from Pro ($5), professional from Startup | Instant on every plan; professional clones from 2 | From 15 seconds of audio (docs) | Custom voices need a consent recording |
| Data and terms | Keeps data by default; zero retention only for some enterprise accounts (`enable_logging=false`) | Zero data retention is an enterprise plan; privacy policy lets you ask for your content not to train models | Not found | Not found | Must tell users the voice is AI-generated |
| PCM output | 16 to 44.1 kHz, S16LE | Not on the page I could open | Not checked | Not checked | 24 kHz |

## Notes that matter more than the table

- **Cartesia's free plan cannot ship**: no commercial licence, and when credits run out requests are blocked. The $5 Pro plan (100,000 credits, about 2 hours of audio) covers many games at this volume and adds the commercial licence and instant cloning.
- **ElevenLabs** is the dearest and the one reviewers name most expressive. Its emotion tags are on the Turbo and Conversational models, which are not the top-priced ones; check which model has tags *and* the quality you want. Data is kept by default.
- **Inworld** is the cheapest and has a commercial licence on the free pay-as-you-go plan. I found no latency number on its page and nothing on data retention.
- **Hume Octave 2** is a preview, and its price is unclear (sources span ten-fold). Its pitch is acting from natural-language direction, which is what the table's `style` field would feed.
- **Persona voices**: `af_heart`, `am_adam`, `bf_emma` are Kokoro ids. Every hosted provider needs a map from those to its own voices (`voiceMap` in `SpeechApiOptions` does this for OpenAI), and a cartoon-first character may want a designed or cloned voice rather than a stock one; cloning needs consent from whoever's voice it is.
- **Data leaving the machine** is the cost against Kokoro and a self-hosted pod (ADR-0010 R6): every spoken line is sent to a third party, who keeps it by default at ElevenLabs. A self-hosted pod keeps text off third-party TTS but still sends it to RunPod.
- Third-party sources disagreed or were out of date more than once (ElevenLabs was $0.10 and $0.05 a thousand characters before an October cut; Cartesia plan prices differed by site). Everything in the table should be confirmed on the vendor's page before money is spent.

## Recommendation

For the ADR (VIK-145), treat the hosted route as **opt-in, behind a key, with Kokoro the offline default and the fallback when the provider is down** (the hub already reports `tts_failed`). If a hosted voice is wanted:

1. **Try Cartesia Sonic 3.6 first** for a live avatar: it is the one built for speed, a game costs about a quarter, and the $5 plan carries the licence. 
2. **Try ElevenLabs Flash or v4 Turbo alongside it** if Cartesia's voices are too plain for the emotions (taunts, nerves): spend a few cents on the ten-line set per provider, blind, and score by the rubric.
3. Keep Inworld as the cheap alternative if both cost too much; do not build on OpenAI.

The cheapest next step is Jian's: put `CARTESIA_API_KEY` and `ELEVENLABS_API_KEY` in `.env`, and I write the two small adapters (they take `AudioChunk.text` like Chatterbox's) and run the bench blind. The ten lines are 669 characters, so a run is a fraction of a cent to about five cents per provider.

## Sources

- OpenAI: [Text to speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) (deprecation, disclosure rule).
- ElevenLabs: [API pricing](https://elevenlabs.io/pricing/api), [text-to-speech models](https://elevenlabs.io/docs/overview/capabilities/text-to-speech), [Zero Retention Mode](https://elevenlabs.io/docs/developers/resources/zero-retention-mode). Third-party price cut report: [Cartesia's ElevenLabs pricing page](https://www.cartesia.ai/learn/elevenlabs-pricing) (a competitor's page; the prices match ElevenLabs' own).
- Cartesia: [pricing](https://cartesia.ai/pricing), [models](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest), [zero data retention](https://docs.cartesia.ai/enterprise/zero-data-retention), [privacy policy](https://cartesia.ai/legal/privacy).
- Inworld: [pricing](https://inworld.ai/pricing).
- Hume: [Octave 2 docs](https://dev.hume.ai/docs/text-to-speech-tts/overview.md) and third-party price trackers (the pricing page itself did not list Octave).
