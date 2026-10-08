# vikaki

*video + kaki (Malay for "friend")*

An open-source engine that gives you a live avatar from a microphone or from text. A stylised 3D (VRM) avatar lip-syncs to speech, blinks and emotes, and can appear as your camera in browser meetings, in a local browser page, or as a video feed other programs can open. An LLM can drive the same avatar over MCP.

**Status:** early development. Nothing is usable yet. See [PLAN.md](PLAN.md) for scope and [SLICES.md](SLICES.md) for the build order.

## Run what exists

```bash
pnpm install
make demo    # builds, serves on a free port and opens the demo page
```

`make demo-speech` opens the **speech demo**: type text (or pick a preset), press Speak, and the avatar says it. It shows what the hub reports (`speech_started`, `speech_finished`, cancels), and measures how long speech takes to start and how fast a cancel stops it. Without Kokoro installed it uses a steady "aah" test voice and says so (see [docs/tts.md](docs/tts.md) for real speech).

The demo page shows the avatar with controls for each mouth shape, blinking, your microphone, and any audio file you pick, plus live meters of what lip sync reports. Microphone audio stays in the page. `?mode=mic` on `/avatar` turns the mic on directly.

## Docs

- [PLAN.md](PLAN.md): problem, scope, requirements, shape
- [SLICES.md](SLICES.md): demo-able increments with test plans
- [QUESTIONS.md](QUESTIONS.md): decision register
- [docs/adr](docs/adr): architecture decisions

## Licence

Apache-2.0. See [LICENSE](LICENSE).
